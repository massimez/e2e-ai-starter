import type { hc } from "hono/client";
import type { AppType } from "../../app";

export type { InferRequestType, InferResponseType } from "hono/client";
export type { AppType } from "../../app";
export type Client = ReturnType<typeof hc<AppType>>;
