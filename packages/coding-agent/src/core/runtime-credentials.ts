import type {
	AuthOperationOptions,
	Credential,
	CredentialAccountInfo,
	CredentialAccountKey,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";

/** Async credential store overlay for non-persistent runtime API keys. */
export class RuntimeCredentials implements CredentialStore {
	private readonly store: CredentialStore;
	private readonly overrides = new Map<string, string>();
	/** Modifications not yet written or failed, for example an OAuth refresh. */
	private readonly pendingModifications = new Set<Promise<void>>();

	constructor(store: CredentialStore) {
		this.store = store;
		// Bind only the capabilities the backing store actually has, so `listAccounts === undefined`
		// keeps meaning "one credential per provider".
		if (store.listAccounts) {
			this.listAccounts = (options) =>
				store.listAccounts?.call(store, options) as Promise<readonly CredentialAccountInfo[]>;
		}
		if (store.selectAccount) {
			this.selectAccount = (providerId, accountKey, options) =>
				store.selectAccount?.call(store, providerId, accountKey, options) as Promise<boolean>;
		}
		if (store.deleteAccount) {
			this.deleteAccount = (providerId, accountKey, options) =>
				store.deleteAccount?.call(store, providerId, accountKey, options) as Promise<boolean>;
		}
	}

	setRuntimeApiKey(providerId: string, apiKey: string): void {
		this.overrides.set(providerId, apiKey);
	}

	removeRuntimeApiKey(providerId: string): void {
		this.overrides.delete(providerId);
	}

	hasRuntimeApiKey(providerId: string): boolean {
		return this.overrides.has(providerId);
	}

	async read(
		providerId: string,
		options?: AuthOperationOptions & { accountKey?: CredentialAccountKey },
	): Promise<Credential | undefined> {
		options?.signal?.throwIfAborted();
		const override = this.overrides.get(providerId);
		if (override) return { type: "api_key", key: override };
		return this.store.read(providerId, options);
	}

	/** Forwarded to the backing store; absent when it holds one credential per provider. */
	listAccounts?: (options?: AuthOperationOptions) => Promise<readonly CredentialAccountInfo[]>;

	/** Forwarded to the backing store; see {@link CredentialStore.selectAccount}. */
	selectAccount?: (
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	) => Promise<boolean>;

	/** Forwarded to the backing store; see {@link CredentialStore.deleteAccount}. */
	deleteAccount?: (
		providerId: string,
		accountKey: CredentialAccountKey,
		options?: AuthOperationOptions,
	) => Promise<boolean>;

	async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const entries = new Map((await this.store.list(options)).map((entry) => [entry.providerId, entry]));
		options?.signal?.throwIfAborted();
		for (const providerId of this.overrides.keys()) {
			entries.set(providerId, { providerId, type: "api_key" });
		}
		return [...entries.values()];
	}

	modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		const modification = this.store.modify(providerId, fn, options);
		const pending = modification.then(
			() => undefined,
			() => undefined,
		);
		this.pendingModifications.add(pending);
		void pending.finally(() => this.pendingModifications.delete(pending));
		return modification;
	}

	/**
	 * Resolves when every modification started so far is written or failed. An OAuth refresh may
	 * already have spent the single-use refresh token, so exiting before its result is written would
	 * leave only the spent token in auth.json.
	 */
	async settled(): Promise<void> {
		await Promise.all(this.pendingModifications);
	}

	async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
		options?.signal?.throwIfAborted();
		await this.store.delete(providerId, options);
		this.overrides.delete(providerId);
	}
}
