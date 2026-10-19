# Picture quality: what is measured, how, and what is for Josh to approve

Story 2.3 (choose picture mode and acknowledge uncertainty) reviews a saved set of pictures: how sharp, large and evenly lit each picture is, which views the set shows, which views are missing, whether the pictures are used for **direct image-derived conversion** or for **research-assisted reconstruction**, and, for direct conversion with incomplete inputs, that the person knowingly accepted the risk of invented or inaccurate geometry ("Generate anyway"). This page is the one place the definitions are written down for people; the code that holds them is `lib/picture-quality.ts` (pure, client-safe) and `lib/picture-decode.ts` (the browser's decoder), and Story 7.9 reuses both on the device.

Nothing here is a model, a heuristic that looks at what a picture shows, or a server-side image step. **The server never decodes an image.** Every number below is measured in the browser, from the picture's own pixels, and what the browser reports is an **untrusted claim**: the database stores it as sent, checks its range and shape, and applies the same thresholds to it only to decide whether an acknowledgment is required. It proves nothing about the picture.

## The definitions

The **Spine** (the project's architecture spine, `_bmad-output/planning-artifacts/architecture/architecture-nova3D-2026-09-14/ARCHITECTURE-SPINE.md`: the document of fixed decisions that the stories build on) fixes the thresholds, the kernel's shape, the 512 px copy, the meaning of "clipped" and the seven labels. The choices it leaves open are marked **(decided here)** and are for Josh's approval (see "For Josh to approve", below).

| Term | Definition |
| --- | --- |
| The analyzed copy | A copy of the picture whose **long edge is at most 512 px**, never enlarged, made after the image's **EXIF orientation is applied**. **(decided here)** The decoder (`lib/picture-decode.ts`) makes it with the platform's `drawImage` at high smoothing quality (`createImageBitmap` with `imageOrientation: 'from-image'`, then a canvas; a browser that does not know that option is asked again without it, and its default is that orientation). Its size is `copySize(width, height)`: the long edge is scaled to 512 and the short edge rounded, at least 1 px. |
| The input of the analyzer | `{width, height, data}`, RGBA, 8 bits a channel, of that copy, and the picture's **natural** width and height. |
| Composite | **(decided here)** A pixel with alpha under 255 is composited over white in integers: `c' = (c * a + 255 * (255 - a) + 127) div 255` for each colour channel `c` (rounded half up). |
| Luminance | **(decided here)** The integer `(299 * R + 587 * G + 114 * B + 500) div 1000` of the composited pixel, from 0 to 255. |
| Blur | The **population variance** of the integer responses of the 4-neighbour 3x3 Laplacian kernel `[0 1 0; 1 -4 1; 0 1 0]` over the **interior pixels only** (the copy without its outer ring). **(decided here)** Computed exactly in integers and rounded half up to **3 decimals**. A copy under 3x3 has no interior and its blur is **0**. A 0/255 checkerboard with an even interior has blur 1,040,400; a ramp has 0. |
| Clipped | **(decided here)** The share of **all** the pixels of the copy whose luminance is **0 or 255**, one combined count (not separate dark and bright shares), rounded half up to **4 decimals**. |
| Short edge | The smaller of the picture's natural width and height, an integer in pixels. |
| Thresholds | Short edge **at least 800 px**, blur **at least 100**, clipped **at most 0.35 (35%)**. Each result is `ok` or the named problem `resolution`, `blur` or `exposure`, judged on the **kept (rounded)** numbers, so a value exactly on a threshold is `ok`. |
| Labels | `front`, `back`, `left`, `right`, `top`, `bottom`, `detail`. One label for each picture, chosen by the person (there is no default). |
| Coverage | The **distinct labels among `front` to `bottom`** must number **at least 3** for direct conversion. **(decided here)** A `detail` close-up is **not an angle** and does not count. The views to add are recommended **in the order front, back, left, right, top, bottom**, as many as are needed to reach 3. |
| Incomplete | Coverage under 3, **or** any picture with a problem. |
| Obstruction | The person confirms, with a labelled checkbox, that nothing blocks the subject in any picture. No model detects obstruction in this version. There is no override: without the confirmation the review cannot be recorded, in either mode. |

The measurements are kept as numbers: the short edge as an integer, blur to 3 decimals, clipped to 4 (`projects.request_images.short_edge_px`, `blur_variance`, `clipped_fraction`).

### The functions

`lib/picture-quality.ts` exports the whole rule as pure functions, with no runtime import, no clock, no random source, no `fetch`, no `process` and no `crypto`:

- `analyze(copy, natural)` returns `{shortEdgePx, blurVariance, clippedFraction}`;
- `assess(measurements)` returns `ok` or the named problem for `resolution`, `blur` and `exposure`, and the list of the named ones;
- `coverage(labels)` returns the distinct angles, whether there are enough, and the views to add;
- `incomplete(labels, measurements)` is the rule above;
- `reviewDigestInput(...)` is the exact text the database hashes into the acknowledgment's digest.

They are unit-tested on **synthetic pixel buffers built from formulas** (flat, ramp, 0/255 checkerboard, over- and under-exposed, seeded noise): no image file is part of the tests of the rule. The database's twin of `incomplete` is `projects.picture_review_incomplete`, and a test holds the two equal over a table of cases that includes every threshold edge.

## What is recorded, and what is not

One idempotent command, `api.record_picture_review`, records the review as an **immutable successor request revision** pinned to the ordered images (`docs/authority-contract.md`, "Reviewing pictures"). It records the mode, each picture's label and measurements, that the person confirmed nothing blocks the subject and, for direct conversion, the confirmed scope and outcome, and (only when the database finds the inputs incomplete) the **Generate anyway acknowledgment**: its time, and the SHA-256 of the length-prefixed scope, outcome and, for each picture in order, its position, upload, **staged SHA-256** and label. The acknowledgment is therefore pinned to these pictures in this order and this scope; it cannot be reused for others. It is **not an approval**: it starts no conversion, approves no plan and authorizes no cost.

Nothing is converted, researched or paid for by this story: the conversion, the subject of a research-assisted request and the permissions are Stories 2.13, 2.9 and the engine stories. The pictures are **retained** when the review is confirmed (Story 2.12, "Retaining a picture", below).

## Getting the pixels

From the `File`s of the picture screen when they exist (the review right after saving; they are handed over in memory, checked against the saved SHA-256, and let go of when the review is left). After a reload, one picture at a time through a **single-use download ticket**: `POST /api/transfers/tickets` with `{direction: 'download', kind: 'staging', id}`, then `GET <gateway>/v1/files/staging/<id>` with `Authorization: Ticket ...`, at the gateway the ticket names. The bytes are hashed and must equal the saved SHA-256 (otherwise the picture is shown as changed and not used). They live in memory only: never in a URL that is shown or stored, in storage, or in a log; each picture is decoded and released before the next. The thumbnail is a small object URL of a JPEG drawn from the 512 copy. A picture whose private copy lapsed, whose download is refused, or that cannot be decoded is shown with a plain reason, a remedy and a link back to the picture screen, and counts as a problem that **cannot be acknowledged**.

This is the first and only place the application reads a picture back; the structure tests allow `direction: 'download'` in `lib/picture-fetch.ts` alone. Since Story 2.12 a picture that is **pinned** (retained when a review was confirmed) is read from its retained copy instead (`kind: 'retained'`, `GET <gateway>/v1/files/retained/<id>`, the same single-use ticket and the same 30 seconds), and its bytes must equal the **retained** SHA-256 and length that were recorded, not the staged ones; a picture that is not pinned is read from staging as before. The measurements stay valid for the retained copy because the strip leaves the pixels untouched.

The read-back is bounded. The ticket request, the download (to its last byte) and the decode each have **30 seconds**: one that is not finished by then is given up and shown as a problem that can be tried again (a download that is not finished is `network`, a decode that is not finished is `busy`). The download address is the ticket's gateway **origin** with `/v1/files/staging/<id>`, nothing else of the ticket's address. A status of 408, 425, 429 or 5xx from the gateway is `network` (try again); 404 and 410 mean the private copy is gone (`lapsed`); 401 and 403 mean the session needs refreshing (`reload`); anything else is a refusal. A length the gateway announces that is not the saved one is not read at all, and a body is read through a reader that stops at the saved length: more than that is `changed`. The Files the picture screen hands over are kept for the last Save only, for at most 15 minutes, and let go as soon as the answer to Save is not a save.

A picture whose **file header states more than 100 megapixels** (a PNG's IHDR, a JPEG's start of frame, a WebP's VP8, VP8L or VP8X chunk; `imageDimensions` in `lib/picture-quality.ts`) is refused as `too_large_pixels` **before any decoder is asked to open it**; the same limit applies to the size the decoder reports. When the decoder supplies no size, the header's is used for the short edge.

## Retaining a picture: what the strip removes, and what it keeps

When a review is confirmed (Story 2.12), the gateway keeps each picture as an immutable copy **from which every metadata segment has been removed except the EXIF orientation**. The strip is in `workers/files/src/strip.ts`: plain Node, `node:zlib`'s `crc32` and no other import, run in the gateway's memory on the staged object. It is **lossless for the pixels**: nothing is decoded, re-encoded, resized or recompressed; the entropy-coded data of a JPEG, the `IDAT` chunks of a PNG and the image chunks of a WebP are copied byte for byte. A picture whose structure it cannot parse is **refused** (`strip_failed`) and never kept unstripped. The result is a pure function of the input, so the same picture gives the same bytes, the same retained digest and, for one upload, the same manifest root every time.

| Format | Kept | Removed |
| --- | --- | --- |
| JPEG | the start and end markers and every segment that decodes the image: `DQT`, `SOF`, `DHT`, `DRI`, `DNL`, `DAC`, `SOS` with its entropy-coded data and restart markers (several scans for a progressive picture), and the Adobe `APP14` segment | every other `APPn` segment (JFIF, EXIF, XMP, ICC profile, FlashPix, MPF, Photoshop and IPTC), every `COM` comment, and anything after the end marker |
| PNG | `IHDR`, `PLTE`, `tRNS`, `IDAT`, `IEND`, `gAMA`, `cHRM`, `sRGB`, `sBIT`, `bKGD` and the animation chunks `acTL`, `fcTL`, `fdAT` | every other chunk: `tEXt`, `zTXt`, `iTXt`, `tIME`, `eXIf`, `iCCP`, `pHYs`, `sPLT`, `hIST` and private ones |
| WebP | a simple file (no `VP8X`) holds no metadata and passes unchanged; with `VP8X`: `VP8`, `VP8L`, `ALPH`, `ANIM` and `ANMF` | `ICCP`, `EXIF`, `XMP` and unknown chunks, with their `VP8X` flags cleared and the RIFF size rewritten |

**The orientation is the one thing that is kept.** The EXIF orientation tag (`0x0112`, a value from 1 to 8) is read from the original EXIF with every offset bounds-checked, and re-written as a **minimal orientation-only EXIF block** (a 36-byte `APP1` segment for a JPEG, right after the start marker; an `eXIf` chunk before the first `IDAT` for a PNG; an `EXIF` chunk and the `VP8X` EXIF flag for a WebP). No other tag survives, and **no GPS data, thumbnail, maker note or camera identity** does. A picture with no valid orientation gets no EXIF block at all. The browser and the later steps apply the orientation; the file is not rotated.

**Removing an ICC profile can change how a wide-gamut picture is displayed** (a Display P3 or Adobe RGB photograph is shown as if it were sRGB where a viewer reads the profile). This follows the story's "every metadata segment except orientation" and is deliberate: the profile is metadata, and the retained copy has none. The colorimetric hints `gAMA`, `cHRM`, `sRGB` and `sBIT` of a PNG are kept (they describe how to read the pixels), and so is an Adobe `APP14` (it says how a CMYK or YCCK JPEG is encoded). If the loss of a profile is judged to matter, adding it back is a change to the strip's removal list, which is an Ask first.

**What this story does not do.** The provider-bound derivative of Story 2.5 is a different copy: it is transient and unstored, carries no metadata at all and must **bake the orientation into the pixels** before it drops the tag; that is recorded for Story 2.5 and is not done here. Nor are thumbnails, deleting or purging a retained picture, or giving back the 2 GiB per Account (Epic 8).

## Known limits

What the measurements cannot see. None of these is a defect to be fixed in this story, and each is a reason the numbers are claims and not verdicts:

- **Clipped counts pure white or black over ALL the pixels.** A studio photograph on a pure white background, or a transparent PNG (composited over white), reads as clipped in proportion to the background, whatever the subject looks like.
- **Blur is the variance over the whole image.** A smooth, plain subject (a matte white vase, a flat-coloured figure) can read as blurry although it is in focus, and a busy background can hide a blurred subject.
- **A privacy mode that randomizes or blanks the canvas read-back** (some browsers do, to stop fingerprinting) inflates the blur (noise) or gives a clipped share of 1 (blank). The numbers then describe the browser, not the picture. Nothing detects it.
- **There is no corpus of real photographs yet.** The thresholds and the rounding are tested on synthetic pixels built from formulas, and by hand-worked cases; nobody has measured a set of real photographs to see where good and poor ones fall. The margins (blur 100 against hundreds to thousands for a sharp photograph) are a judgment, which is why they are for Josh to approve.
- **Pictures above 100 megapixels are refused** (a header that states more, or a decoder that reports more); a header that is cut short or unknown is left to the decoder, whose 30 second limit then applies.
- **The numbers are claims.** The database stores them as sent and cross-checks only their range and the rule; it cannot tell a forged claim from a measurement.

## For Josh to approve

These are decisions of this story, flagged because the Spine leaves them open. Nothing gates on the approval; a change to any of them is an "Ask first":

1. The thresholds as chosen by the Spine (800 px, blur 100, 35%) with **wide margins**: a sharp photograph's blur is in the hundreds to thousands.
2. **A `detail` close-up does not count as one of the three views.**
3. The luma weights and the integer rounding (`299/587/114`, `+ 500`, `div 1000`), the kernel (the 4-neighbour Laplacian over interior pixels only), the population variance, the combined clipped count, and the rounding of the kept numbers (3 and 4 decimals).
4. The composite over white in integers (`+ 127`, `div 255`) for transparent pictures.
5. **Browser resampling parity with Story 7.9.** The exact part (grayscale, kernel, variance, clipped share, thresholds, coverage) is identical on every device; only the platform's downscale to 512 px differs between browsers and devices. A picture sitting within a rounding error of a threshold may read differently on two devices. The margins make this a rare edge, and the acknowledgment rule applies to whichever number the browser claimed.

## What Story 7.9 must reuse

`lib/picture-quality.ts` and `lib/picture-decode.ts` unchanged: the same copy, the same numbers, the same thresholds. The decoder's dependencies are injectable (a canvas, `createImageBitmap`), so a device or a test can supply its own; the analyzer takes plain RGBA. The database's twin of the rule is `projects.picture_review_incomplete`.
