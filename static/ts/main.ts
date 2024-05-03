// @deno-types='@types/streamsaver'
import streamSaver from 'streamsaver'
import { TarStream, TarStreamFile } from './lib/tar.ts'

const files: File[] = []

const ulTag = document.querySelector<HTMLUListElement>('ul')!
const progressTag = document.querySelector<HTMLProgressElement>('progress')!

async function addFiles(fileList: Iterable<File>) {
	for (const file of fileList)
		if (files.findIndex(f => f.name === file.name) === -1) {
			await new Promise(a => setTimeout(a, 0))
			files.push(file)
			ulTag.append(
				createTag('li', liTag => liTag.append(
					file.name,
					createTag('button', buttonTag => {
						buttonTag.append(
							createTag('i', iTag => {
								iTag.classList.add('fa-solid', 'fa-trash-can')
							})
						)
						buttonTag.addEventListener('click', function (_event) {
							deleteFile(this.parentElement!.textContent!)
							this.parentElement!.remove()
						}, { passive: true, once: true })
					})
				))
			)
		}
	document.querySelector<HTMLInputElement>('input[type="file"]')!.value = ''
	if (files.length)
		document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = false
}

function deleteFile(fileName: string) {
	const i = files.findIndex(file => file.name === fileName)
	if (i > -1)
		files.splice(i, 1)
	if (!files.length)
		document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled = true
}

document.querySelector<HTMLDivElement>('label[for="file"]')!.addEventListener('dragover', function (event) {
	event.preventDefault()
})

document.querySelector<HTMLLabelElement>('label[for="file"]')!.addEventListener('drop', function (event) {
	event.preventDefault()
	addFiles(event.dataTransfer?.files ?? [])
})

document.querySelector<HTMLInputElement>('input[type="file"]')!.addEventListener('change', function (_event) {
	addFiles(this.files ?? [])
})

document.querySelector<HTMLFormElement>('form')!
	.addEventListener('submit', async function (event) {
		event.preventDefault()
		if (!files.length)
			return

		this.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(tag => tag.disabled = true)

		let sizeRead = 0
		const totalSize = files.reduce((sum, file) => sum + file.size + 1024 - (file.size % 512 || 512), 1024)
		progressTag.setAttribute('max', totalSize.toString())
		if (
			!await new ReadableStream<TarStreamFile>({
				pull(controller) {
					if (!files.length)
						return controller.close()
					const file = files.shift()!
					controller.enqueue({
						pathname: file.name,
						size: file.size,
						iterable: file.stream()
							.pipeThrough(new TransformStream({
								flush() {
									for (const tag of ulTag.children)
										if (tag.textContent === file.name) {
											tag.remove()
											break
										}
								}
							}))
					})
				}
			})
				.pipeThrough(new TarStream())
				.pipeThrough(new TransformStream({
					transform(chunk, controller) {
						sizeRead += chunk.length
						progressTag.setAttribute('value', sizeRead.toString())
						controller.enqueue(chunk)
					}
				}))
				.pipeThrough(new CompressionStream('gzip'))
				.pipeTo(streamSaver.createWriteStream('archive.tar.gz'))
				.then(() => true)
				.catch(() => false)
		) {
			[...ulTag.children].forEach(x => x.remove())
			while (files.length)
				files.shift()
		}

		this.querySelectorAll<HTMLInputElement>('input').forEach(tag => tag.disabled = false)
		progressTag.setAttribute('value', '0')
	})

type TagNames = keyof HTMLElementTagNameMap

type CreateTagAttribute<T extends TagNames> = Partial<HTMLElementTagNameMap[T]>
type CreateTagFunc<T extends TagNames> = (tag: HTMLElementTagNameMap[T]) => unknown
function createTag<T extends TagNames>(type: T, func?: CreateTagFunc<T>): HTMLElementTagNameMap[T]
function createTag<T extends TagNames>(type: T, attributes?: CreateTagAttribute<T>, func?: CreateTagFunc<T>): HTMLElementTagNameMap[T]
function createTag<T extends TagNames>(
	type: T,
	arg1?: CreateTagAttribute<T> | CreateTagFunc<T>,
	arg2?: CreateTagFunc<T>
): HTMLElementTagNameMap[T] {
	const tag = document.createElement(type)
	if (arg1)
		if (typeof arg1 === 'function')
			arg1(tag)
		else {
			for (const key in arg1)
				tag.setAttribute(key, arg1[key] as string)
			if (arg2)
				arg2(tag)
		}
	return tag
}

createTag('a', { href: '' })
