import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { RedisClientService } from './redis-client.service';

type Handler = (payload: string) => void;

/** 广播消息格式：带发送方实例 ID，收到自己发出的消息时忽略（本地已经处理过） */
interface Envelope {
  from: string;
  topic: string;
  payload: string;
}

/**
 * 跨实例事件广播：典型用途是「缓存失效通知」——一台实例修改了数据，所有实例都要丢弃本地缓存。
 *
 * publish(topic, payload)：
 *   1. 立即在本进程内调用该 topic 的所有订阅者
 *   2. 启用 Redis 时再经 Redis pub/sub 广播给其他实例（其他实例收到后调用各自的订阅者）
 * Redis 不可用时只在本进程内生效（其他实例靠各自缓存的 TTL 过期兜底），不影响功能。
 *
 * 用法：
 *   constructor(bus: EventBusService) { bus.subscribe('dict', (code) => this.cache.delete(code)); }
 *   bus.publish('dict', code);
 */
@Injectable()
export class EventBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly instanceId = randomUUID();
  private readonly handlers = new Map<string, Set<Handler>>();
  private readonly channel: string;
  private pub: Redis | null = null;
  private sub: Redis | null = null;

  constructor(private readonly redis: RedisClientService) {
    this.channel = redis.key('events');
  }

  /** 启用 Redis 时建立订阅连接（失败只告警：退化为仅本进程内分发） */
  onModuleInit(): void {
    if (!this.redis.enabled) return;
    this.pub = this.redis.createConnection();
    this.sub = this.redis.createConnection();
    this.pub?.on('error', () => undefined);
    this.sub?.on('error', () => undefined);
    this.sub?.on('message', (_ch, raw) => this.onRemote(raw));
    // 断线重连后 ioredis 会自动重新订阅（autoResubscribe 默认开启）
    this.sub
      ?.connect()
      .then(() => this.sub?.subscribe(this.channel))
      .catch((e) => this.logger.warn(`事件广播订阅失败，缓存失效只在本实例生效: ${(e as Error).message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.pub?.quit().catch(() => undefined);
    await this.sub?.quit().catch(() => undefined);
  }

  /** 订阅某个主题；返回取消订阅函数 */
  subscribe(topic: string, handler: Handler): () => void {
    let set = this.handlers.get(topic);
    if (!set) this.handlers.set(topic, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** 发布：本进程立即处理 + 广播给其他实例（广播失败静默） */
  publish(topic: string, payload = ''): void {
    this.dispatch(topic, payload);
    if (!this.pub) return;
    const msg: Envelope = { from: this.instanceId, topic, payload };
    this.pub.publish(this.channel, JSON.stringify(msg)).catch(() => undefined);
  }

  /** 调用本进程内该主题的全部订阅者（单个订阅者出错不影响其他订阅者） */
  private dispatch(topic: string, payload: string): void {
    for (const h of this.handlers.get(topic) ?? []) {
      try {
        h(payload);
      } catch (e) {
        this.logger.error(`事件处理失败（${topic}）: ${(e as Error).message}`);
      }
    }
  }

  /** 收到其他实例的广播：忽略自己发出的（本地已处理），其余分发给本进程订阅者 */
  private onRemote(raw: string): void {
    try {
      const msg = JSON.parse(raw) as Envelope;
      if (msg.from === this.instanceId) return;
      this.dispatch(msg.topic, msg.payload);
    } catch {
      /* 格式不对的消息直接忽略 */
    }
  }
}
