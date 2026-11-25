import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIYUAN_URL,
  buildSiyuanDocPath,
  connectSiyuan,
  createSiyuanDoc,
  disconnectSiyuan,
  getSiyuanConnection,
  listSiyuanNotebooks,
  normalizeSiyuanUrl,
} from "../src/siyuan";

describe("SiYuan Note integration", () => {
  let storageData: Record<string, unknown>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    storageData = {};
    fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("chrome", {
      storage: {
        local: {
          get: vi.fn((key: string) =>
            Promise.resolve({ [key]: storageData[key] }),
          ),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(storageData, items);
            return Promise.resolve();
          }),
          remove: vi.fn((key: string) => {
            delete storageData[key];
            return Promise.resolve();
          }),
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("normalizes SiYuan API URLs and defaults to 127.0.0.1:6806", () => {
    expect(normalizeSiyuanUrl("")).toBe(DEFAULT_SIYUAN_URL);
    expect(normalizeSiyuanUrl("http://127.0.0.1:6806/")).toBe(
      "http://127.0.0.1:6806",
    );
    expect(() => normalizeSiyuanUrl("ftp://127.0.0.1:6806")).toThrow();
    expect(() => normalizeSiyuanUrl("not-a-url")).toThrow();
  });

  it("builds valid SiYuan document paths", () => {
    expect(buildSiyuanDocPath("", "Windows11新建4个虚拟桌面方法")).toBe(
      "/Windows11新建4个虚拟桌面方法",
    );
    expect(buildSiyuanDocPath("/AI对话/", "豆包/测试")).toBe(
      "/AI对话/豆包-测试",
    );
    expect(buildSiyuanDocPath("AI对话\\豆包", "  ")).toBe(
      "/AI对话/豆包/AI Conversation",
    );
  });

  it("connects, stores credentials locally, lists open notebooks, and creates a doc", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 0,
          msg: "",
          data: { notebooks: [] },
        }),
    });

    const conn = await connectSiyuan("http://127.0.0.1:6806/", "secret-token");
    expect(conn).toEqual({
      apiUrl: "http://127.0.0.1:6806",
      apiToken: "secret-token",
    });
    expect(await getSiyuanConnection()).toEqual(conn);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 0,
          msg: "",
          data: {
            notebooks: [
              { id: "nb-1", name: "工作笔记", closed: false },
              { id: "nb-2", name: "已关闭", closed: true },
            ],
          },
        }),
    });

    const notebooks = await listSiyuanNotebooks();
    expect(notebooks).toEqual([{ id: "nb-1", name: "工作笔记" }]);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          code: 0,
          msg: "",
          data: "20261125104000-abcdefg",
        }),
    });

    const created = await createSiyuanDoc(
      "nb-1",
      "/AI对话",
      "测试标题",
      "# Hello",
    );
    expect(created).toEqual({
      docId: "20261125104000-abcdefg",
      path: "/AI对话/测试标题",
    });

    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://127.0.0.1:6806/api/filetree/createDocWithMd",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Token secret-token",
        },
        body: JSON.stringify({
          notebook: "nb-1",
          path: "/AI对话/测试标题",
          markdown: "# Hello",
        }),
      },
    );

    await disconnectSiyuan();
    expect(await getSiyuanConnection()).toBeNull();
  });

  it("surfaces SiYuan auth errors clearly", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    await expect(
      connectSiyuan("http://127.0.0.1:6806", "bad-token"),
    ).rejects.toThrow(/API token/i);
  });
});
