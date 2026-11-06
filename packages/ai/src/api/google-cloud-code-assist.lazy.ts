import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const googleCloudCodeAssistApi = (): ProviderStreams => lazyApi(() => import("./google-cloud-code-assist.ts"));
