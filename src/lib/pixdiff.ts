// 두 그림의 픽셀 비교 — 판 비교 렌즈(versions.ts)와 PowerPoint 대조 검사(check.ts)가 같이 쓴다.
// check.ts 에서 떼었다 — check.ts 는 내보내기(pptxgenjs · jszip)를 끌고 와서, 판 비교만 하는 화면도 시작 청크에 그것들을 실었다

/** 채널 차이가 이보다 크면 다른 픽셀 */
const THRESHOLD = 48;

/** 두 그림의 차이 — 다른 픽셀 비율(%)과 빨간 덧칠 그림(data URL) */
export function compare(a: Uint8ClampedArray, b: Uint8ClampedArray, w: number, h: number) {
	const out = new ImageData(w, h);
	const raw = new Uint8Array(w * h);
	let count = 0;
	const near = (i: number, x: number, y: number) => {
		for (let dy = -1; dy <= 1; dy++) {
			const yy = y + dy;
			if (yy < 0 || yy >= h) continue;
			for (let dx = -1; dx <= 1; dx++) {
				const xx = x + dx;
				if (xx < 0 || xx >= w) continue;
				const j = (yy * w + xx) * 4;
				if (Math.max(Math.abs(a[i] - b[j]), Math.abs(a[i + 1] - b[j + 1]), Math.abs(a[i + 2] - b[j + 2])) <= THRESHOLD) return true;
			}
		}
		return false;
	};
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 4;
			const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
			if (d <= THRESHOLD || near(i, x, y)) continue;
			raw[y * w + x] = 1;
		}
	}
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const k = y * w + x;
			if (!raw[k]) continue;
			const n = raw[k - w - 1] + raw[k - w] + raw[k - w + 1] + raw[k - 1] + raw[k + 1] + raw[k + w - 1] + raw[k + w] + raw[k + w + 1];
			if (n <= 4) continue;
			count++;
			const i = k * 4;
			out.data[i] = 232;
			out.data[i + 1] = 40;
			out.data[i + 2] = 30;
			out.data[i + 3] = 220;
		}
	}
	const c = document.createElement("canvas");
	c.width = w;
	c.height = h;
	c.getContext("2d")!.putImageData(out, 0, 0);
	return { score: Math.round((count / (w * h)) * 10000) / 100, mask: c.toDataURL("image/png") };
}
