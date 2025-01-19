const pkgFile = Bun.file("package.json")
const pkg = JSON.parse(await pkgFile.text())
const newVersion = Bun.argv[2]

// write the new version
pkg.version = newVersion
await Bun.write(pkgFile, JSON.stringify(pkg, null, 2))
