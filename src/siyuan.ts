/*
 * =========================================================
 * AI Exporter - siyuan.ts
 * =========================================================
 *
 * SiYuan Note (思源笔记) local Kernel API integration:
 * connects to a local or LAN SiYuan instance (default
 * http://127.0.0.1:6806), lists open notebooks, and creates
 * a Markdown document via /api/filetree/createDocWithMd.
 *
 * Credentials (apiUrl + apiToken) are kept in
 * chrome.storage.local (never .sync), like GitHub and Notion.
 */

export const DEFAULT_SIYUAN_URL = "http://127.0.0.1:6806";

const STORAGE_KEY = "siyuanConnection";

export interface SiyuanConnection {
  apiUrl: string;
  apiToken: string;
}

export interface SiyuanNotebook {
  id: string;
  name: string;
  icon?: string;
}

export function normalizeSiyuanUrl(raw: string): string {
  const trimmed = raw.trim() || DEFAULT_SIYUAN_URL;
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Invalid SiYuan API URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("SiYuan API URL must start with http:// or https://.");
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

export function buildSiyuanDocPath(parentPath: string, title: string): string {
  const cleanParent = parentPath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/");

  const cleanTitle =
    title
      .trim()
      .replace(/[/\\]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim() || "AI Conversation";

  return cleanParent ? `/${cleanParent}/${cleanTitle}` : `/${cleanTitle}`;
}

export async function getSiyuanConnection(): Promise<SiyuanConnection | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const value = stored[STORAGE_KEY] as Partial<SiyuanConnection> | undefined;

  if (typeof value?.apiUrl === "string" && value.apiUrl !== "") {
    return {
      apiUrl: value.apiUrl,
      apiToken: typeof value.apiToken === "string" ? value.apiToken : "",
    };
  }

  return null;
}

async function storeConnection(connection: SiyuanConnection): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: connection });
}

export async function disconnectSiyuan(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEY);
}

async function siyuanRequest<T>(
  connection: SiyuanConnection,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (connection.apiToken) {
    headers.Authorization = `Token ${connection.apiToken}`;
  }

  let response: Response;

  try {
    response = await fetch(`${connection.apiUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      `Cannot reach SiYuan at ${connection.apiUrl}. Make sure SiYuan Note is running.`,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "SiYuan rejected the API token. Check Settings -> About -> API token in SiYuan.",
    );
  }

  if (!response.ok) {
    throw new Error(`SiYuan API request failed (${response.status}).`);
  }

  const payload = (await response.json()) as {
    code?: number;
    msg?: string;
    data?: T;
  };

  if (payload.code !== 0) {
    throw new Error(payload.msg || `SiYuan returned error code ${payload.code}.`);
  }

  return payload.data as T;
}

export async function connectSiyuan(
  rawApiUrl: string,
  rawApiToken: string,
): Promise<SiyuanConnection> {
  const connection: SiyuanConnection = {
    apiUrl: normalizeSiyuanUrl(rawApiUrl),
    apiToken: rawApiToken.trim(),
  };

  await siyuanRequest(connection, "/api/notebook/lsNotebooks", {});
  await storeConnection(connection);

  return connection;
}

export async function listSiyuanNotebooks(): Promise<SiyuanNotebook[]> {
  const connection = await getSiyuanConnection();

  if (!connection) {
    throw new Error("SiYuan is not connected.");
  }

  const data = await siyuanRequest<{
    notebooks?: Array<{
      id?: string;
      name?: string;
      icon?: string;
      closed?: boolean;
    }>;
  }>(connection, "/api/notebook/lsNotebooks", {});

  return (data?.notebooks ?? [])
    .filter((nb) => typeof nb.id === "string" && nb.id !== "" && !nb.closed)
    .map((nb) => ({
      id: nb.id as string,
      name: (nb.name ?? nb.id) as string,
      ...(nb.icon ? { icon: nb.icon } : {}),
    }));
}

export async function createSiyuanDoc(
  notebookId: string,
  parentPath: string,
  title: string,
  markdown: string,
): Promise<{ docId: string; path: string }> {
  const connection = await getSiyuanConnection();

  if (!connection) {
    throw new Error("SiYuan is not connected.");
  }

  const path = buildSiyuanDocPath(parentPath, title);
  const docId = await siyuanRequest<string>(
    connection,
    "/api/filetree/createDocWithMd",
    {
      notebook: notebookId,
      path,
      markdown,
    },
  );

  return { docId: typeof docId === "string" ? docId : "", path };
}
