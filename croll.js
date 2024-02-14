// 명령줄 인수에 접근
const args = process.argv.slice(2);
const axios = require('axios');
const cheerio = require('cheerio');

// 크롤링할 웹 페이지의 URL
// 웹 페이지 요청
const url = "https://google.com/search?q="+args;
axios.get(url)
  .then(response => {
    // 응답 데이터에서 HTML 추출
    const html = response.data;

    // cheerio를 사용하여 HTML 파싱
    const $ = cheerio.load(html);

    // 원하는 데이터 추출
    const title = $('title').text();
    const description = $('body')
		  .contents()
		  .filter((_, element) => element.type === 'text')
		  .map((_, element) => $(element).text())
		  .get()
		  .join('\n');

    // 추출한 데이터 출력
    console.log('Title:', title);
    console.log('Description:', description);
  })
  .catch(error => {
    console.error('Error:', error);
  });
