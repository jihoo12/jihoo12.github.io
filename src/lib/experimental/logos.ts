// The little designs that can go on the front of Nixchan's hoodie (outfit.ts), drawn onto a canvas
// for her figure to wear (nix-figure.ts) and for the buttons in the wardrobe to show. Each is drawn
// in one colour in a 256 × 256 square, centred, on nothing (so the hoodie shows through round it
// and through any holes in it).

export const LOGOS = [
	{ id: 'snowflake', name: 'Snowflake' },
	{ id: 'heart', name: 'Heart' },
	{ id: 'star', name: 'Star' },
	{ id: 'fish', name: 'Fish' },
	{ id: 'leaf', name: 'Leaf' },
	{ id: 'cat', name: 'Cat' },
	{ id: 'none', name: 'None' },
] as const;
export type LogoId = (typeof LOGOS)[number]['id'];

/** Colours for the design. */
export const LOGO_COLOURS = [
	{ id: 'ice', name: 'Ice blue', hex: '#5f9be8' },
	{ id: 'white', name: 'White', hex: '#fdfbff' },
	{ id: 'pink', name: 'Pink', hex: '#ff8fb3' },
	{ id: 'gold', name: 'Gold', hex: '#ffd24d' },
	{ id: 'leaf', name: 'Leaf green', hex: '#6ccf7f' },
	{ id: 'ink', name: 'Ink', hex: '#1d1b3a' },
] as const;
export type LogoColourId = (typeof LOGO_COLOURS)[number]['id'];

/** Cuts `paint` out of what's drawn so far (an eye, a vein), leaving the hoodie to show through. */
function cut(ctx: CanvasRenderingContext2D, paint: () => void) {
	ctx.save();
	ctx.globalCompositeOperation = 'destination-out';
	paint();
	ctx.restore();
}

/** Draws logo `id` in `colour`, filling a 256 × 256 canvas (cleared first). */
export function drawLogo(ctx: CanvasRenderingContext2D, id: LogoId, colour: string) {
	ctx.clearRect(0, 0, 256, 256);
	ctx.save();
	ctx.translate(128, 128);
	ctx.fillStyle = ctx.strokeStyle = colour;
	ctx.lineCap = ctx.lineJoin = 'round';
	if (id === 'snowflake') {
		// Six arms with a fork near each tip, round a ring, as she's always worn it.
		ctx.lineWidth = 16;
		for (let i = 0; i < 6; i++) {
			ctx.save();
			ctx.rotate((i * Math.PI) / 3);
			ctx.beginPath();
			ctx.moveTo(0, 0);
			ctx.lineTo(0, -104);
			ctx.moveTo(0, -62);
			ctx.lineTo(-28, -88);
			ctx.moveTo(0, -62);
			ctx.lineTo(28, -88);
			ctx.stroke();
			ctx.restore();
		}
		cut(ctx, () => {
			ctx.beginPath();
			ctx.arc(0, 0, 22, 0, Math.PI * 2);
			ctx.fill();
		});
		ctx.lineWidth = 10;
		ctx.beginPath();
		ctx.arc(0, 0, 22, 0, Math.PI * 2);
		ctx.stroke();
	} else if (id === 'heart') {
		ctx.beginPath();
		ctx.moveTo(0, 92);
		ctx.bezierCurveTo(-30, 64, -108, 22, -100, -36);
		ctx.bezierCurveTo(-94, -84, -30, -100, 0, -50);
		ctx.bezierCurveTo(30, -100, 94, -84, 100, -36);
		ctx.bezierCurveTo(108, 22, 30, 64, 0, 92);
		ctx.fill();
	} else if (id === 'star') {
		// Five points, their corners rounded off by a thick stroke round the fill.
		ctx.beginPath();
		for (let i = 0; i < 10; i++) {
			const r = i % 2 ? 40 : 96;
			const a = -Math.PI / 2 + (i * Math.PI) / 5;
			ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r + 8);
		}
		ctx.closePath();
		ctx.lineWidth = 14;
		ctx.fill();
		ctx.stroke();
	} else if (id === 'fish') {
		// A round little fish swimming left: body, forked tail, and an eye cut through.
		ctx.beginPath();
		ctx.ellipse(-14, 0, 78, 54, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.beginPath();
		ctx.moveTo(50, 0);
		ctx.lineTo(108, -48);
		ctx.quadraticCurveTo(92, 0, 108, 48);
		ctx.closePath();
		ctx.lineWidth = 10;
		ctx.fill();
		ctx.stroke();
		cut(ctx, () => {
			ctx.beginPath();
			ctx.arc(-50, -12, 11, 0, Math.PI * 2);
			ctx.fill();
			// The line of its gill.
			ctx.lineWidth = 8;
			ctx.beginPath();
			ctx.arc(-34, 0, 34, -0.7, 0.7);
			ctx.stroke();
		});
	} else if (id === 'leaf') {
		// A leaf on a slant, with its middle vein and two side veins cut through, and its stalk.
		ctx.rotate(-Math.PI / 4);
		ctx.beginPath();
		ctx.moveTo(0, -104);
		ctx.quadraticCurveTo(72, -36, 0, 80);
		ctx.quadraticCurveTo(-72, -36, 0, -104);
		ctx.fill();
		ctx.lineWidth = 12;
		ctx.beginPath();
		ctx.moveTo(0, 76);
		ctx.lineTo(0, 108);
		ctx.stroke();
		cut(ctx, () => {
			ctx.lineWidth = 8;
			ctx.beginPath();
			ctx.moveTo(0, 60);
			ctx.lineTo(0, -78);
			for (const y of [-30, 10]) {
				ctx.moveTo(0, y + 18);
				ctx.lineTo(-26, y - 8);
				ctx.moveTo(0, y + 18);
				ctx.lineTo(26, y - 8);
			}
			ctx.stroke();
		});
	} else if (id === 'cat') {
		// A cat's face, like the ears on her beanie: round, two pointed ears, eyes and a nose cut through.
		ctx.beginPath();
		ctx.ellipse(0, 18, 86, 72, 0, 0, Math.PI * 2);
		ctx.fill();
		ctx.lineWidth = 12;
		for (const side of [-1, 1]) {
			ctx.beginPath();
			ctx.moveTo(side * 30, -40);
			ctx.lineTo(side * 76, -98);
			ctx.lineTo(side * 84, -20);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
		}
		cut(ctx, () => {
			for (const side of [-1, 1]) {
				ctx.beginPath();
				ctx.ellipse(side * 34, 6, 11, 17, 0, 0, Math.PI * 2);
				ctx.fill();
			}
			ctx.beginPath();
			ctx.moveTo(-10, 36);
			ctx.lineTo(10, 36);
			ctx.lineTo(0, 47);
			ctx.closePath();
			ctx.fill();
		});
	}
	ctx.restore();
}
