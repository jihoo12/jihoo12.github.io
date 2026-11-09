// <nix-chan>: a layered Nixchan who perches on elements and reacts to the visitor.
// Markup and styles live in components/NixChan.astro.

const SEAT = 0.75; // Where she sits, as a fraction of her height.
const IDLE_MS = 20_000;
const MAX_LEAN = 3.2;
const NIGHT_FROM = 22;
const NIGHT_UNTIL = 6;
// While searching she keeps at it for longer before nodding off.
const SEARCH_IDLE_MS = 60_000;
// Where she can sit along a perch, from its left edge to its right edge.
const SEARCH_SPOTS = [0.04, 0.5, 0.96];

type Pose = 'idle' | 'coffee' | 'search';

class NixChan extends HTMLElement {
	private lift!: HTMLElement;
	private squash!: HTMLElement;
	private face!: HTMLElement;
	private upper!: HTMLElement;
	private legL!: HTMLElement;
	private legR!: HTMLElement;
	private blinkEyes!: HTMLElement;
	private sleepyEyes!: HTMLElement;
	private bodies = new Map<Pose, HTMLElement>();

	private perches: HTMLElement[] = [];
	private current: HTMLElement | null = null;
	private pos = { x: 0, y: 0 };
	private along: number | null = null;

	private still = matchMedia('(prefers-reduced-motion: reduce)').matches;
	private pose: Pose = 'idle';
	private busy = false;
	private asleep = false;
	private happy = false;
	private blinking = false;
	private visible = true;

	private pointerX: number | null = null;
	private lean = 0;
	private drop = 0;
	private amp = 1;
	private breath = 0;
	private swing = 0;
	private lastFrame = 0;
	private lastActive = performance.now();
	private graceUntil = 0;
	private sleepPoint: { x: number; y: number } | null = null;

	private abort = new AbortController();
	private timers: number[] = [];
	private blinkTimer = 0;
	private searchTimer = 0;
	private frameId = 0;
	private resize?: ResizeObserver;
	private seen?: IntersectionObserver;

	connectedCallback() {
		const get = (name: string) => this.querySelector<HTMLElement>(`[data-nix="${name}"]`)!;
		this.lift = get('lift');
		this.squash = get('squash');
		this.face = get('face');
		this.upper = get('upper');
		this.legL = get('leg-l');
		this.legR = get('leg-r');
		this.blinkEyes = get('eyes-closed');
		this.sleepyEyes = get('eyes-sleepy');
		this.querySelectorAll<HTMLElement>('[data-body]').forEach((el) => this.bodies.set(el.dataset.body as Pose, el));

		this.perches = Array.from(document.querySelectorAll<HTMLElement>(this.dataset.perch ?? ''));
		this.current = this.perches[0] ?? null;
		if (!this.current) return;
		if (this.dataset.pose === 'search') this.along = SEARCH_SPOTS[2];

		this.listen();
		this.applyPose(false);
		this.settle();
		this.classList.add('ready');

		const stage = this.offsetParent;
		if (stage) {
			this.resize = new ResizeObserver(() => this.settle());
			this.resize.observe(stage);
			this.seen = new IntersectionObserver(([entry]) => (this.visible = entry.isIntersecting));
			this.seen.observe(stage);
		}
		this.timers.push(window.setInterval(() => this.checkIdle(), 400));
		this.timers.push(window.setInterval(() => this.snore(), 1500));
		this.timers.push(window.setInterval(() => this.applyPose(true), 60_000));
		if (!this.still) {
			this.queueBlink();
			if (this.along !== null) this.queueSearch();
			this.frameId = requestAnimationFrame((t) => this.frame(t));
		}
	}

	disconnectedCallback() {
		this.abort.abort();
		this.timers.forEach(clearInterval);
		clearTimeout(this.blinkTimer);
		clearTimeout(this.searchTimer);
		cancelAnimationFrame(this.frameId);
		this.resize?.disconnect();
		this.seen?.disconnect();
	}

	private listen() {
		const { signal } = this.abort;
		document.addEventListener('pointermove', (e) => this.onPointerMove(e), { signal });
		for (const name of ['keydown', 'scroll', 'pointerdown']) {
			window.addEventListener(
				name,
				() => {
					this.wake();
					if (!this.asleep) this.markActive();
				},
				{ signal, passive: true },
			);
		}
		// Only hop where cards sit side by side and a pointer can hover them.
		const canHop = matchMedia('(hover: hover) and (min-width: 851px)');
		for (const perch of this.perches) {
			let timer = 0;
			perch.addEventListener(
				'pointerenter',
				() => {
					clearTimeout(timer);
					timer = window.setTimeout(() => canHop.matches && !this.asleep && this.hop(perch), 420);
				},
				{ signal },
			);
			perch.addEventListener('pointerleave', () => clearTimeout(timer), { signal });
			perch.addEventListener('focusin', () => canHop.matches && !this.asleep && this.hop(perch), { signal });
		}
		canHop.addEventListener(
			'change',
			() => {
				if (!canHop.matches) this.current = this.perches[0];
				this.settle();
			},
			{ signal },
		);
		this.querySelector('[data-nix="poke"]')?.addEventListener('click', () => this.poke(), { signal });
	}

	private place(x: number, y: number) {
		this.pos = { x, y };
		this.style.transform = `translate(${x}px, ${y}px)`;
	}

	private spot(card: HTMLElement) {
		const stage = this.offsetParent!.getBoundingClientRect();
		const box = card.getBoundingClientRect();
		const x =
			this.along === null
				? box.right - stage.left - this.offsetWidth - 14
				: box.left - stage.left + this.along * (box.width - this.offsetWidth);
		return { x, y: box.top - stage.top - this.offsetHeight * SEAT };
	}

	private settle() {
		if (!this.current || this.busy) return;
		const { x, y } = this.spot(this.current);
		this.place(x, y);
	}

	private bounce() {
		if (this.still) return;
		this.squash.animate(
			[
				{ transform: 'scale(1, 1)' },
				{ transform: 'scale(1.07, .9)', offset: 0.14 },
				{ transform: 'scale(.95, 1.07)', offset: 0.32 },
				{ transform: 'scale(1, 1)', offset: 0.78 },
				{ transform: 'scale(1.08, .9)', offset: 0.88 },
				{ transform: 'scale(1, 1)' },
			],
			{ duration: 640 },
		);
	}

	private hop(card: HTMLElement) {
		if (this.busy || card === this.current) return;
		this.current = card;
		this.leap();
	}

	private leap() {
		const from = this.pos;
		const to = this.spot(this.current!);
		this.place(to.x, to.y);
		if (this.pose === 'search') this.face.classList.toggle('flip', to.x > from.x);
		if (this.still) return;
		this.busy = true;
		const at = (p: { x: number; y: number }) => `translate(${p.x}px, ${p.y}px)`;
		this.animate([{ transform: at(from) }, { transform: at(to) }], { duration: 470, delay: 90, easing: 'linear', fill: 'backwards' });
		this.lift.animate(
			[
				{ transform: 'translateY(0)', easing: 'cubic-bezier(.2, .7, .5, 1)' },
				{ transform: 'translateY(-88px)', offset: 0.5, easing: 'cubic-bezier(.5, 0, .8, .4)' },
				{ transform: 'translateY(0)' },
			],
			{ duration: 470, delay: 90 },
		);
		this.bounce();
		window.setTimeout(() => {
			this.busy = false;
			this.settle();
		}, 660);
	}

	private queueSearch() {
		this.searchTimer = window.setTimeout(() => {
			if (this.pose === 'search' && this.visible && !this.busy) {
				const others = SEARCH_SPOTS.filter((spot) => spot !== this.along);
				this.along = others[Math.floor(Math.random() * others.length)];
				this.leap();
				window.setTimeout(() => this.pose === 'search' && this.particle('huh', '?'), 760);
			}
			this.queueSearch();
		}, 1500 + Math.random() * 1500);
	}

	private wantedPose(): Pose {
		if (this.asleep) return 'idle';
		if (this.dataset.pose === 'search') return 'search';
		const forced = new URLSearchParams(location.search).get('nix-hour');
		const hour = forced === null ? new Date().getHours() : Number(forced);
		return hour >= NIGHT_FROM || hour < NIGHT_UNTIL ? 'coffee' : 'idle';
	}

	private applyPose(animated: boolean) {
		const next = this.wantedPose();
		if (next !== this.pose && animated) this.bounce();
		this.pose = next;
		this.bodies.forEach((el, name) => el.classList.toggle('on', name === next));
		this.syncEyes();
	}

	private syncEyes() {
		this.sleepyEyes.classList.toggle('on', this.asleep);
		this.blinkEyes.classList.toggle('on', !this.asleep && (this.happy || this.blinking));
	}

	private particle(kind: string, text: string) {
		if (this.still) return;
		const el = document.createElement('span');
		el.className = `nix-fx ${kind}`;
		el.textContent = text;
		el.setAttribute('aria-hidden', 'true');
		el.addEventListener('animationend', () => el.remove());
		this.lift.append(el);
	}

	private markActive() {
		this.lastActive = performance.now();
	}

	private setAsleep(asleep: boolean) {
		this.asleep = asleep;
		this.applyPose(true);
	}

	private checkIdle() {
		if (this.asleep || !this.visible || performance.now() - this.lastActive <= (this.along === null ? IDLE_MS : SEARCH_IDLE_MS)) return;
		this.sleepPoint = null;
		this.graceUntil = performance.now() + 250;
		this.setAsleep(true);
	}

	private snore() {
		if (this.asleep && this.visible) this.particle('', 'z');
	}

	private wake() {
		if (!this.asleep || performance.now() < this.graceUntil) return;
		this.setAsleep(false);
		this.particle('bang', '!');
	}

	private onPointerMove(e: PointerEvent) {
		this.pointerX = e.clientX;
		if (!this.asleep) {
			this.markActive();
			return;
		}
		if (performance.now() < this.graceUntil) return;
		if (!this.sleepPoint) {
			this.sleepPoint = { x: e.clientX, y: e.clientY };
			return;
		}
		if (Math.hypot(e.clientX - this.sleepPoint.x, e.clientY - this.sleepPoint.y) > 50) {
			this.wake();
			this.markActive();
		}
	}

	private poke() {
		if (this.asleep) return; // Tapped within the falling-asleep grace period.
		this.happy = true;
		this.syncEyes();
		this.particle('heart', '♥');
		this.bounce();
		window.setTimeout(() => {
			this.happy = false;
			this.syncEyes();
		}, 900);
	}

	private queueBlink() {
		this.blinkTimer = window.setTimeout(() => {
			if (!this.asleep) this.blink(Math.random() < 0.22);
			this.queueBlink();
		}, 1900 + Math.random() * 3600);
	}

	private blink(again: boolean) {
		this.blinking = true;
		this.syncEyes();
		window.setTimeout(() => {
			this.blinking = false;
			this.syncEyes();
			if (again) window.setTimeout(() => this.blink(false), 130);
		}, 115);
	}

	private frame(now: number) {
		const dt = Math.min(0.05, (now - this.lastFrame) / 1000 || 0);
		this.lastFrame = now;
		if (this.visible) {
			let target = 0;
			if (this.asleep) target = 5.5;
			else if (this.pose === 'search') target = Math.sin(now / 620) * 5;
			else if (this.pointerX !== null) {
				const box = this.getBoundingClientRect();
				target = Math.max(-1, Math.min(1, (this.pointerX - (box.left + box.width / 2)) / 420)) * MAX_LEAN;
			}
			const ease = 1 - Math.pow(0.002, dt);
			this.lean += (target - this.lean) * ease;
			this.drop += ((this.asleep ? 3 : 0) - this.drop) * ease;
			this.amp += ((this.asleep ? 0.18 : 1) - this.amp) * ease;
			this.breath += dt * (this.asleep ? 1.05 : 1.75);
			this.swing += dt * (this.asleep ? 0.9 : 2.5);
			const b = Math.sin(this.breath) * (this.asleep ? 1.6 : 1);
			this.upper.style.transform = `translateY(${this.drop.toFixed(2)}px) rotate(${this.lean.toFixed(2)}deg) scale(${(1 - b * 0.003).toFixed(4)}, ${(1 + b * 0.009).toFixed(4)})`;
			this.legL.style.transform = `rotate(${(Math.sin(this.swing) * this.amp * 3.1).toFixed(2)}deg)`;
			this.legR.style.transform = `rotate(${(Math.sin(this.swing * 0.93 + 1.2) * this.amp * 3.1).toFixed(2)}deg)`;
		}
		this.frameId = requestAnimationFrame((t) => this.frame(t));
	}
}

if (!customElements.get('nix-chan')) customElements.define('nix-chan', NixChan);
