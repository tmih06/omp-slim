// Translate Bun's locked dependency paths for the inherited npm installer artifact.

/** Convert Bun registry and workspace entries to the package map used by the installer generator. */
export function toNpmLockPackages(lock) {
	// Trust boundary: Bun's on-disk lockfile format is versioned independently of this script.
	if (lock.lockfileVersion !== 2 || !lock.workspaces || !lock.packages) {
		throw new Error("Expected a Bun v2 text lockfile with workspaces and packages");
	}
	const workspacePaths = new Map(Object.entries(lock.workspaces).map(([path, entry]) => [entry.name, path]));
	const packages = { ...lock.workspaces };
	for (const [key, entry] of Object.entries(lock.packages)) {
		const [specifier, registry, metadata = {}, integrity] = entry;
		const names = key.match(/(?:@[^/]+\/)?[^/]+/g);
		const name = names.at(-1);
		let path = "";
		for (const parent of names.slice(0, -1)) {
			path = path ? `${path}/node_modules/${parent}` : (workspacePaths.get(parent) ?? `node_modules/${parent}`);
		}
		path = `${path ? `${path}/` : ""}node_modules/${name}`;
		const workspaceMarker = specifier.indexOf("@workspace:");
		if (workspaceMarker !== -1) {
			packages[path] = { resolved: specifier.slice(workspaceMarker + "@workspace:".length), link: true };
			continue;
		}
		// Trust boundary: installer output supports registry packages, not git or local tarballs.
		const match = /^((?:@[^/]+\/)?[^@]+)@(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/.exec(specifier);
		if (!match || !integrity) throw new Error(`Unsupported Bun lock entry: ${key} (${specifier})`);
		const [, packageName, version] = match;
		const tarballName = packageName.split("/").at(-1);
		const resolved = registry || `https://registry.npmjs.org/${packageName}/-/${tarballName}-${version}.tgz`;
		const { optionalPeers, ...fields } = metadata;
		const converted = { ...fields, version, resolved, integrity };
		for (const field of ["os", "cpu", "libc"]) {
			if (typeof converted[field] === "string") converted[field] = [converted[field]];
		}
		if (typeof converted.bin === "string") converted.bin = { [tarballName]: converted.bin };
		if (optionalPeers?.length) {
			converted.peerDependenciesMeta = Object.fromEntries(optionalPeers.map((peer) => [peer, { optional: true }]));
		}
		packages[path] = converted;
	}
	return packages;
}
