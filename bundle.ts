/// <reference lib="deno.window" />

// @deno-types='esbuild'
import { build, stop } from 'esbuild'
import { denoPlugins } from '@luca/esbuild-deno-loader'

await Promise.allSettled([
	// Make ./static/js/ directory
	Deno.mkdir('./static/js/', { recursive: true }),
])

const promises: Promise<void>[] = []
for await (const dirEntry of Deno.readDir('./static/ts/')) {
	if (dirEntry.isFile && dirEntry.name.endsWith('.ts')) {
		console.log('   ./static/ts/' + dirEntry.name)
		console.log('=> ./static/js/' + dirEntry.name.slice(0, -2) + 'js')
		console.log('=> ./static/js/' + dirEntry.name.slice(0, -2) + 'min.js')
		promises.push(
			esbuild('./static/ts/' + dirEntry.name, './static/js/' + dirEntry.name.slice(0, -2) + 'js', false),
			esbuild('./static/ts/' + dirEntry.name, './static/js/' + dirEntry.name.slice(0, -2) + 'min.js', true),
		)
	}
}
await Promise.allSettled(promises)
stop()
// await Promise.allSettled([
// 	Deno.rename('./static/js/serviceWorker.js', './static/serviceWorker.js'),
// 	Deno.rename('./static/js/serviceWorker.js', './static/serviceWorker.min.js')
// ])

console.log(performance.now().toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'ms')

async function esbuild(inPath: string, outPath: string, minify: boolean) {
	const { errors, warnings } = await build({
		plugins: denoPlugins({ configPath: await Deno.realPath('./deno.jsonc') }),
		entryPoints: [inPath],
		outfile: outPath,
		format: 'esm',
		bundle: true,
		minify,
	})
	errors.forEach((x) => console.error(x))
	warnings.forEach((x) => console.warn(x))
}
