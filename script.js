const database = [
    { title: "test", url: "/documents/test.html" },
];

document.getElementById('searchForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const val = document.getElementById('query').value.toLowerCase();
    
    // 데이터에서 제목(title)에 검색어가 포함된 것들만 필터링
    const results = database.filter(item => item.title.toLowerCase().includes(val));

    if (results.length > 0) {
        // <a> 태그를 사용해 하이퍼링크 생성
        const htmlList = results.map(item => 
            `<li><a href="${item.url}">${item.title}</a></li>`
        ).join('');
        
        document.getElementById('result').innerHTML = `<ul>${htmlList}</ul>`;
    } else {
        document.getElementById('result').innerText = "검색 결과가 없습니다.";
    }
});