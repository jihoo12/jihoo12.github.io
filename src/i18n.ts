// The site is English first; Korean pages live under /ko/ with the same paths.
// Paper drafts stay English only, so they have no /ko/ version.
export type Lang = 'en' | 'ko';

/** For `[...lang]` routes: one English page at the root and one Korean page under /ko/. */
export const langPaths = () => [{ params: { lang: undefined } }, { params: { lang: 'ko' } }];

/** The language of a `[...lang]` route. */
export const routeLang = (param: string | undefined): Lang => (param === 'ko' ? 'ko' : 'en');

/** The language of any page, read from its URL. */
export const urlLang = (url: URL): Lang => (url.pathname === '/ko' || url.pathname.startsWith('/ko/') ? 'ko' : 'en');

/** `path` (always the English one, starting with /) in the given language. */
export const localize = (path: string, lang: Lang) => (lang === 'ko' ? `/ko${path}` : path);

/** The English path of a page, whichever language it's in. */
export const unlocalize = (path: string) => path.replace(/^\/ko(?=\/|$)/, '') || '/';

/** hreflang links for a page that exists in both languages. */
export const pairAlternates = (path: string) => [
	{ hreflang: 'en', href: path },
	{ hreflang: 'ko', href: localize(path, 'ko') },
	{ hreflang: 'x-default', href: path },
];

export const ogLocale = (lang: Lang) => (lang === 'ko' ? 'ko_KR' : 'en_US');

export const dateLabel = (lang: Lang) => new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', { dateStyle: 'medium' });

export const nav = {
	en: { home: 'Home', projects: 'Projects', journal: 'Journal', comics: 'Comics', about: 'About', main: 'Main navigation', homeLabel: 'Jihoo home', clock: 'Switch between day and night', switchTo: '한국어', switchLabel: '한국어로 보기' },
	ko: { home: '홈', projects: '프로젝트', journal: '저널', comics: '만화', about: '소개', main: '주 메뉴', homeLabel: 'Jihoo 홈', clock: '낮과 밤 바꾸기', switchTo: 'EN', switchLabel: 'View in English' },
} satisfies Record<Lang, Record<string, string>>;
