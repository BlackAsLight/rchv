export interface TarStreamFile {
	pathname: string
	size: number
	sizeExtension?: boolean
	iterable: Iterable<Uint8Array> | AsyncIterable<Uint8Array>
	options?: Partial<TarStreamOptions>
}

export interface TarStreamDir {
	pathname: string
	options?: Partial<TarStreamOptions>
}

export interface TarStreamOptions {
	mode: string
	uid: string
	gid: string
	mtime: number
	uname: string
	gname: string
	devmajor: string
	devminor: string
}

export class TarStream {
	#readable: ReadableStream<Uint8Array>
	#writable: WritableStream<TarStreamFile | TarStreamDir>
	constructor() {
		const { readable, writable } = new TransformStream<
			TarStreamFile | TarStreamDir,
			TarStreamFile | TarStreamDir
		>()
		const gen = (async function* () {
			const paths: string[] = []
			for await (const chunk of readable) {
				if (
					"size" in chunk &&
					(
						chunk.size < 0 ||
						Math.pow(8, chunk.sizeExtension ? 12 : 11) < chunk.size ||
						chunk.size.toString() === "NaN"
					)
				) {
					throw new Error(
						"Invalid Size Provided! Size cannot exceed 8 GiBs by default or 64 GiBs with sizeExtension set to true.",
					)
				}

				chunk.pathname = chunk.pathname.split("/").filter((x) => x).join("/")
				if (chunk.pathname.startsWith("./")) {
					chunk.pathname = chunk.pathname.slice(2)
				}
				if (!("size" in chunk)) {
					chunk.pathname += "/"
				}

				const pathname = new TextEncoder().encode(chunk.pathname)
				if (pathname.length > 256) {
					throw new Error(
						"Invalid Pathname! Pathname cannot exceed 256 bytes.",
					)
				}

				let i = Math.max(0, pathname.lastIndexOf(47))
				if (pathname.slice(i + 1).length > 100) {
					throw new Error(
						"Invalid Filename! Filename cannot exceed 100 bytes.",
					)
				}

				if (pathname.length <= 100) {
					i = 0
				} else {
					for (; i > 0; --i) {
						i = pathname.lastIndexOf(47, i)
						if (pathname.slice(i + 1).length > 100) {
							i = Math.max(0, pathname.indexOf(47, i + 1))
							break
						}
					}
				}

				const prefix = pathname.slice(0, i)
				if (prefix.length > 155) {
					throw new Error(
						"Invalid Pathname! Pathname needs to be split-able on a forward slash separator into [155, 100] bytes respectively.",
					)
				}
				if (paths.includes(chunk.pathname)) {
					continue
				}
				paths.push(chunk.pathname)
				const typeflag = "size" in chunk ? "0" : "5"
				const sizeExtension = "size" in chunk && chunk.sizeExtension || false
				const encoder = new TextEncoder()
				const header = new Uint8Array(512)

				header.set(prefix.length ? pathname.slice(i + 1) : pathname) // name
				header.set(
					encoder.encode(
						(chunk.options?.mode ?? (typeflag === "5" ? "755" : "644"))
							.padStart(6, "0") +
						" \0" + // mode
						(chunk.options?.uid ?? "").padStart(6, "0") + " \0" + // uid
						(chunk.options?.gid ?? "").padStart(6, "0") + " \0" + // gid
						("size" in chunk ? chunk.size.toString(8) : "").padStart(
							sizeExtension ? 12 : 11,
							"0",
						) + (sizeExtension ? "" : " ") + // size
						(chunk.options?.mtime?.toString(8) ??
							Math.floor(new Date().getTime() / 1000).toString(8)).padStart(11, "0") +
						" " + // mtime
						" ".repeat(8) + // checksum | Needs to be updated
						typeflag + // typeflag
						"\0".repeat(100) + // linkname
						"ustar\0" + // magic
						"00" + // version
						(chunk.options?.uname ?? "").padEnd(32, "\0") + // uname
						(chunk.options?.gname ?? "").padEnd(32, "\0") + // gname
						(chunk.options?.devmajor ?? "").padEnd(8, "\0") + // devmajor
						(chunk.options?.devminor ?? "").padEnd(8, "\0"), // devminor
					),
					100,
				)
				header.set(prefix, 345) // prefix

				header.set(
					encoder.encode(
						header.reduce((x, y) => x + y).toString(8).padStart(6, "0") + "\0",
					),
					148,
				) // update checksum
				yield header

				if ("size" in chunk) {
					let size = 0
					for await (const x of chunk.iterable) {
						size += x.length
						yield x
					}
					if (chunk.size !== size) {
						throw new Error(
							"Invalid Tarball! Provided size did not match bytes read from iterable.",
						)
					}
					yield new Uint8Array(new Array(512 - chunk.size % 512).fill(0))
				}
			}
			yield new Uint8Array(new Array(1024).fill(0))
		})()

		this.#readable = new ReadableStream({
			type: "bytes",
			async pull(controller) {
				// If Byte Stream
				if (controller.byobRequest?.view) {
					const buffer = new Uint8Array(
						controller.byobRequest.view.buffer,
						controller.byobRequest.view.byteOffset, // Will this ever be anything but zero?
						controller.byobRequest.view.byteLength,
					)
					let offset = 0
					while (offset < buffer.length) {
						const { done, value } = await gen.next()
						if (done) {
							if (offset) {
								controller.byobRequest.respond(offset)
								return controller.close()
							}
							controller.close()
							return controller.byobRequest.respond(0)
						}
						if (value.length > buffer.length - offset) {
							buffer.set(value.slice(0, buffer.length - offset), offset)
							offset = buffer.length - offset
							controller.byobRequest.respond(buffer.length)
							return controller.enqueue(value.slice(offset))
						}
						buffer.set(value, offset)
						offset += value.length
					}
					return controller.byobRequest.respond(buffer.length)
				}
				// Else Default Stream
				const { done, value } = await gen.next()
				if (done) {
					return controller.close()
				}
				controller.enqueue(value)
			},
		})
		this.#writable = writable
	}

	get readable(): ReadableStream<Uint8Array> {
		return this.#readable
	}

	get writable(): WritableStream<TarStreamFile | TarStreamDir> {
		return this.#writable
	}
}

export interface TarStreamEntry {
	pathname: string
	header: TarStreamHeader
	readable?: ReadableStream<Uint8Array>
}

export interface OldStyleFormat {
	name: string
	mode: string
	uid: string
	gid: string
	size: number
	mtime: number
	checksum: string
	typeflag: string
	linkname: string
	pad: Uint8Array
}

export interface PosixUstarFormat {
	name: string
	mode: string
	uid: string
	gid: string
	size: number
	mtime: number
	checksum: string
	typeflag: string
	linkname: string
	magic: string
	version: string
	uname: string
	gname: string
	devmajor: string
	devminor: string
	prefix: string
	pad: Uint8Array
}

export type TarStreamHeader = OldStyleFormat | PosixUstarFormat

export class UnTarStream {
	#readable: ReadableStream<TarStreamEntry>
	#writable: WritableStream<Uint8Array>
	constructor() {
		const { readable, writable } = new TransformStream<
			Uint8Array,
			Uint8Array
		>()
		const reader = readable
			.pipeThrough(
				new TransformStream(
					{ // Slices ReadableStream's Uint8Array into 512 byte chunks.
						x: new Uint8Array(0),
						transform(chunk, controller) {
							const y = new Uint8Array(this.x.length + chunk.length)
							y.set(this.x)
							y.set(chunk, this.x.length)

							for (let i = 512; i <= y.length; i += 512) {
								controller.enqueue(y.slice(i - 512, i))
							}
							this.x = y.length % 512
								? y.slice(-y.length % 512)
								: new Uint8Array(0)
						},
						flush(controller) {
							if (this.x.length) {
								controller.error(
									"Tarball has an unexpected number of bytes.!!",
								)
							}
						},
					} as Transformer<Uint8Array, Uint8Array> & { x: Uint8Array },
				),
			)
			.pipeThrough(
				new TransformStream(
					{ // Trims the last Uint8Array chunks off.
						x: [],
						transform(chunk, controller) {
							this.x.push(chunk)
							if (this.x.length === 3) {
								controller.enqueue(this.x.shift()!)
							}
						},
						flush(controller) {
							if (this.x.length < 2) {
								controller.error("Tarball was too small to be valid.")
							} else if (!this.x.every((x) => x.every((x) => x === 0))) {
								controller.error("Tarball has invalid ending.")
							}
						},
					} as Transformer<Uint8Array, Uint8Array> & { x: Uint8Array[] },
				),
			)
			.getReader()
		let header: TarStreamHeader | undefined
		this.#readable = new ReadableStream<TarStreamEntry>(
			{
				cancelled: false,
				async pull(controller) {
					while (header != undefined) {
						await new Promise((a) => setTimeout(a, 0))
					}

					const { done, value } = await reader.read()
					if (done) {
						return controller.close()
					}

					const decoder = new TextDecoder()
					{ // Validate checksum
						const checksum = value.slice()
						checksum.set(new Uint8Array(8).fill(32), 148)
						if (
							checksum.reduce((x, y) => x + y) !==
							parseInt(decoder.decode(value.slice(148, 156 - 2)), 8)
						) {
							return controller.error(
								"Invalid Tarball. Header failed to pass checksum.",
							)
						}
					}
					header = {
						name: decoder.decode(value.slice(0, 100)).replaceAll("\0", ""),
						mode: decoder.decode(value.slice(100, 108 - 2)),
						uid: decoder.decode(value.slice(108, 116 - 2)),
						gid: decoder.decode(value.slice(116, 124 - 2)),
						size: parseInt(decoder.decode(value.slice(124, 136)).trimEnd(), 8),
						mtime: parseInt(decoder.decode(value.slice(136, 148 - 1)), 8),
						checksum: decoder.decode(value.slice(148, 156 - 2)),
						typeflag: decoder.decode(value.slice(156, 157)),
						linkname: decoder.decode(value.slice(157, 257)).replaceAll(
							"\0",
							"",
						),
						pad: value.slice(257),
					}
					if (header.typeflag === "\0") {
						header.typeflag = "0"
					}
					// Check if header is POSIX ustar | new TextEncoder().encode('ustar\0' + '00')
					if (
						[117, 115, 116, 97, 114, 0, 48, 48].every((byte, i) =>
							value[i + 257] === byte
						)
					) {
						header = {
							...header,
							magic: decoder.decode(value.slice(257, 263)),
							version: decoder.decode(value.slice(263, 265)),
							uname: decoder.decode(value.slice(265, 297)).replaceAll("\0", ""),
							gname: decoder.decode(value.slice(297, 329)).replaceAll("\0", ""),
							devmajor: decoder.decode(value.slice(329, 337)).replaceAll(
								"\0",
								"",
							),
							devminor: decoder.decode(value.slice(337, 345)).replaceAll(
								"\0",
								"",
							),
							prefix: decoder.decode(value.slice(345, 500)).replaceAll(
								"\0",
								"",
							),
							pad: value.slice(500),
						}
					}

					if (header.typeflag === "0") {
						const size = header.size
						let i = Math.ceil(size / 512)
						const isCancelled = () => this.cancelled
						let lock = false
						controller.enqueue({
							pathname: ("prefix" in header && header.prefix.length
								? header.prefix + "/"
								: "") + header.name,
							header,
							readable: new ReadableStream({
								type: "bytes",
								async pull(controller) {
									if (i > 0) {
										lock = true
										// If Byte Stream
										if (controller.byobRequest?.view) {
											const buffer = new Uint8Array(
												controller.byobRequest.view.buffer,
												controller.byobRequest.view.byteOffset, // Will this ever be anything but zero?
												controller.byobRequest.view.byteLength,
											)
											let offset = 0
											while (offset < buffer.length) {
												const { done, value } = await (async function () {
													const x = await reader.read()
													if (!x.done && i-- === 1) {
														x.value = x.value.slice(0, size % 512)
													}
													return x
												})()
												if (done) {
													header = undefined
													lock = false
													if (offset) {
														controller.byobRequest.respond(offset)
														return controller.close()
													}
													controller.close()
													return controller.byobRequest.respond(0)
												}
												if (value.length > buffer.length - offset) {
													buffer.set(
														value.slice(0, buffer.length - offset),
														offset,
													)
													offset = buffer.length - offset
													lock = false
													controller.byobRequest.respond(buffer.length)
													return controller.enqueue(value.slice(offset))
												}
												buffer.set(value, offset)
												offset += value.length
											}
											lock = false
											return controller.byobRequest.respond(buffer.length)
										}
										// Else Default Stream
										const { done, value } = await reader.read()
										if (done) {
											header = undefined
											return controller.error("Tarball ended unexpectedly.")
										}
										// Pull is unlocked before enqueue is called because if pull is in the middle of processing a chunk when cancel is called, nothing after enqueue will run.
										lock = false
										controller.enqueue(
											i-- === 1 ? value.slice(0, size % 512) : value,
										)
									} else {
										header = undefined
										if (isCancelled()) {
											reader.cancel()
										}
										controller.close()
									}
								},
								async cancel() {
									while (lock) {
										await new Promise((a) =>
											setTimeout(a, 0)
										)
									}
									try {
										while (i-- > 0) {
											if ((await reader.read()).done) {
												throw new Error("Tarball ended unexpectedly.")
											}
										}
									} catch (error) {
										throw error
									} finally {
										header = undefined
									}
								},
							}),
						})
					} else {
						controller.enqueue({
							pathname: ("prefix" in header && header.prefix.length
								? header.prefix + "/"
								: "") + header.name,
							header,
						})
						header = undefined
					}
				},
				cancel() {
					this.cancelled = true
				},
			} as UnderlyingDefaultSource<TarStreamEntry> & { cancelled: boolean },
		)
		this.#writable = writable
	}

	get readable(): ReadableStream<TarStreamEntry> {
		return this.#readable
	}

	get writable(): WritableStream<Uint8Array> {
		return this.#writable
	}
}
