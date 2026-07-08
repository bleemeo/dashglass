import {
  anonymousAuth,
  type AuthProvider,
  type InstantQueryParams,
  type LabelQueryParams,
  type PromResponse,
  type PrometheusDataSource,
  type RangeQueryParams,
} from "@dashglass/runtime";

export interface HTTPPrometheusDataSourceOptions {
  /**
   * Base URL exposing the Prometheus HTTP API: the Dashglass backend proxy
   * ("" for same-origin), or a Prometheus server directly.
   */
  baseURL: string;
  auth?: AuthProvider;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
}

function toUnixSeconds(date: Date): string {
  return String(date.getTime() / 1000);
}

/**
 * The OSS PrometheusDataSource: near-trivial because the backend mirrors
 * the native Prometheus API paths (DESIGN.md §7.1).
 */
export class HTTPPrometheusDataSource implements PrometheusDataSource {
  private baseURL: string;
  private auth: AuthProvider;
  private fetchFn: typeof fetch;

  constructor(options: HTTPPrometheusDataSourceOptions) {
    this.baseURL = options.baseURL.replace(/\/$/, "");
    this.auth = options.auth ?? anonymousAuth;
    // Bound so calling this.fetchFn() doesn't rebind window.fetch's `this`
    // to the datasource ("Illegal invocation").
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  private async request(
    path: string,
    params: URLSearchParams,
    method: "GET" | "POST",
    signal?: AbortSignal,
  ): Promise<unknown> {
    let url = `${this.baseURL}${path}`;
    let init: RequestInit = { method, signal: signal ?? null };
    if (method === "POST") {
      // POST keeps long PromQL expressions out of URL length limits.
      init.headers = { "Content-Type": "application/x-www-form-urlencoded" };
      init.body = params.toString();
    } else if (params.size > 0) {
      url += `?${params.toString()}`;
    }
    init = await this.auth.decorateRequest(init);

    const response = await this.fetchFn(url, init);
    const body: unknown = await response.json().catch(() => undefined);
    if (!response.ok && (body === undefined || typeof body !== "object")) {
      throw new Error(`Prometheus request failed: HTTP ${response.status}`);
    }
    return body;
  }

  async rangeQuery(params: RangeQueryParams): Promise<PromResponse> {
    const form = new URLSearchParams({
      query: params.query,
      start: toUnixSeconds(params.start),
      end: toUnixSeconds(params.end),
      step: String(params.step),
    });
    return (await this.request(
      "/api/v1/query_range",
      form,
      "POST",
      params.signal,
    )) as PromResponse;
  }

  async instantQuery(params: InstantQueryParams): Promise<PromResponse> {
    const form = new URLSearchParams({ query: params.query });
    if (params.time) {
      form.set("time", toUnixSeconds(params.time));
    }
    return (await this.request(
      "/api/v1/query",
      form,
      "POST",
      params.signal,
    )) as PromResponse;
  }

  private async labelRequest(
    path: string,
    params?: LabelQueryParams,
  ): Promise<string[]> {
    const search = new URLSearchParams();
    for (const matcher of params?.match ?? []) {
      search.append("match[]", matcher);
    }
    if (params?.start) {
      search.set("start", toUnixSeconds(params.start));
    }
    if (params?.end) {
      search.set("end", toUnixSeconds(params.end));
    }
    const body = (await this.request(path, search, "GET", params?.signal)) as {
      status: string;
      data?: string[];
      error?: string;
    };
    if (body.status !== "success") {
      throw new Error(body.error ?? "Prometheus label query failed");
    }
    return body.data ?? [];
  }

  labelNames(params?: LabelQueryParams): Promise<string[]> {
    return this.labelRequest("/api/v1/labels", params);
  }

  labelValues(label: string, params?: LabelQueryParams): Promise<string[]> {
    return this.labelRequest(
      `/api/v1/label/${encodeURIComponent(label)}/values`,
      params,
    );
  }
}
