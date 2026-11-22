import { describe, expect, it } from "vitest";
import { configValueProblem } from "./config";

describe("configValueProblem（与后端 ConfigService 的校验 / 解析规则一致）", () => {
  it("NUMBER：数字通过，空串与非数字不通过", () => {
    expect(configValueProblem("12.5", "NUMBER")).toBeNull();
    expect(configValueProblem("", "NUMBER")).toBeTruthy();
    expect(configValueProblem("abc", "NUMBER")).toBeTruthy();
  });

  it("BOOL：接受 true/false/1/0/on/off/yes/no（不区分大小写）", () => {
    for (const v of ["true", "FALSE", "1", "0", "on", "off", "yes", "No"]) expect(configValueProblem(v, "BOOL")).toBeNull();
    expect(configValueProblem("maybe", "BOOL")).toBeTruthy();
  });

  it("JSON：必须能解析；STRING 不限制", () => {
    expect(configValueProblem('{"a":1}', "JSON")).toBeNull();
    expect(configValueProblem("{a:1}", "JSON")).toBeTruthy();
    expect(configValueProblem("任意内容", "STRING")).toBeNull();
  });
});
