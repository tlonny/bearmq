const pkgFile = Bun.file("package.json")
const pkg = JSON.parse(await pkgFile.text())
const version = pkg.version.split(".").map(Number)

// perform the bump
version[version.length - 1] += 1

// write the new version
pkg.version = version.join(".")
await Bun.write(pkgFile, JSON.stringify(pkg, null, 2))

const fetchLogs = Bun.spawn(["git", "log", "-1", "--pretty=%B"])
const commitMessage = await new Response(fetchLogs.stdout).text()

await Bun.spawn(["git", "add", "package.json"]).exited
await Bun.spawn(["git", "commit", "-m", `Bump version to: ${pkg.version} [skip ci]`]).exited
await Bun.spawn(["git", "tag", `v${pkg.version}`, "-m", commitMessage]).exited
