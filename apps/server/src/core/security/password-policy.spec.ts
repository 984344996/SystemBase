import { checkPasswordStrength, isPasswordExpired, readPasswordPolicy, WEAK_PASSWORDS } from './password-policy';

describe('readPasswordPolicy', () => {
  it('未配置时取宽松默认值（8 位、要求复杂度、不过期）', () => {
    expect(readPasswordPolicy({})).toEqual({ minLength: 8, requireComplexity: true, expireDays: 0 });
  });

  it('非法值回退默认：长度非数字、过期天数为空', () => {
    const p = readPasswordPolicy({ PASSWORD_MIN_LENGTH: 'abc', PASSWORD_EXPIRE_DAYS: '' } as never);
    expect(p.minLength).toBe(8);
    expect(p.expireDays).toBe(0);
  });

  it('可关闭复杂度并自定义长度', () => {
    expect(readPasswordPolicy({ PASSWORD_MIN_LENGTH: '6', PASSWORD_COMPLEXITY: 'off' } as never)).toEqual({
      minLength: 6,
      requireComplexity: false,
      expireDays: 0,
    });
  });
});

describe('checkPasswordStrength', () => {
  const strict = { minLength: 8, requireComplexity: true, expireDays: 0 };

  it('合规密码无任何问题', () => {
    expect(checkPasswordStrength('Sb#2026demoX', 'admin', strict)).toEqual([]);
  });

  it('长度不足', () => {
    expect(checkPasswordStrength('Ab1', 'admin', strict)).toContain('密码长度不能少于 8 位');
  });

  it('复杂度不足（只有小写字母）', () => {
    expect(checkPasswordStrength('abcdefghij', 'admin', strict)).toContain('密码需包含大小写字母与数字中的至少两类');
  });

  it('命中弱密码字典', () => {
    expect(WEAK_PASSWORDS).toContain('admin123');
    expect(checkPasswordStrength('admin123', 'zhangsan', strict)).toContain(
      '密码过于简单（命中常见弱密码字典），请更换',
    );
  });

  it('包含用户名（含倒序）', () => {
    expect(checkPasswordStrength('Admin12345', 'admin', strict)).toContain('密码不能包含用户名');
    expect(checkPasswordStrength('Nimda12345', 'admin', strict)).toContain('密码不能包含用户名');
  });

  it('关闭复杂度后仅校验长度与字典', () => {
    const loose = { minLength: 8, requireComplexity: false, expireDays: 0 };
    expect(checkPasswordStrength('abcdefghij', 'admin', loose)).toEqual([]);
  });
});

describe('isPasswordExpired', () => {
  const policy = { minLength: 8, requireComplexity: true, expireDays: 90 };

  it('未配置有效期 → 永不过期', () => {
    expect(isPasswordExpired(new Date('2000-01-01'), { ...policy, expireDays: 0 })).toBe(false);
  });

  it('从未改过密码（pwdUpdatedAt 为空）→ 不判定过期', () => {
    expect(isPasswordExpired(null, policy)).toBe(false);
  });

  it('超过有效期 → 过期', () => {
    const old = new Date(Date.now() - 91 * 86_400_000);
    expect(isPasswordExpired(old, policy)).toBe(true);
  });

  it('有效期内 → 未过期', () => {
    const recent = new Date(Date.now() - 10 * 86_400_000);
    expect(isPasswordExpired(recent, policy)).toBe(false);
  });
});
