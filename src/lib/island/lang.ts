// Which language the island (and the 3D home's prologue into it) speaks: the site's. Reading a
// Korean page (/ko/…) or pressing the site's language sign remembers it (components/BaseHead.astro,
// components/Header.astro); the island has no /ko/ address of its own, so it reads what was
// remembered. ?lang=ko or ?lang=en on the URL tries one without changing it.
//
// So far it's the people Nixchan talks to and the prologue that speak Korean; the rest is to come.
// Names to keep the same everywhere when it does:
//   Pebble 페블 · Parmen 파르멘 · Hollis 홀리스 · Nixchan 닉스쨩
//   Cloudrest 구름쉼터 · the Windspout 바람기둥 · the Sky Spire 하늘 첨탑 · Temple of the Winds 바람의 신전
//   Lonely Islet 외딴섬 · the Standing Stones 선돌 · the forge 대장간 · sky shards 하늘 조각
//   iron ore 철광석 · iron ingots 철 주괴 · sprinkler 스프링클러 · glider 글라이더
//   Moonfish 달고기 · Sunny Snapper 햇살도미 · Cloud Koi 구름잉어
import type { Lang } from '../../i18n';

export type { Lang };

export const lang: Lang = (() => {
	try {
		const asked = new URLSearchParams(location.search).get('lang');
		if (asked === 'ko' || asked === 'en') return asked;
		return localStorage.getItem('lang') === 'ko' ? 'ko' : 'en';
	} catch {
		return 'en';
	}
})();

/** Pick the words for the island's language. */
export const pick = <T>(words: Record<Lang, T>): T => words[lang];

/** Whether a Korean word ends in a final consonant (받침); anything not Hangul counts as not. */
const closed = (word: string) => {
	const code = word.charCodeAt(word.length - 1) - 0xac00;
	return code >= 0 && code <= 11171 && code % 28 !== 0;
};

/** A Korean word with the particle that fits it: josa('당근', '이', '가') is 당근이, josa('순무', '이', '가') is 순무가. */
export const josa = (word: string, afterClosed: string, afterOpen: string) => word + (closed(word) ? afterClosed : afterOpen);
