const database = [
    { title: "test", url: "/documents/test.html" },
    { title: "japaness", url: "/documents/japaness.html" },
    { title: "social_communication",url: "/documents/social_communication.html"},
];

document.getElementById('searchForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const val = document.getElementById('query').value.toLowerCase();
    
    const results = database.filter(item => item.title.toLowerCase().includes(val));

    if (results.length > 0) {
        const htmlList = results.map(item => 
            `<li><a href="${item.url}">${item.title}</a></li>`
        ).join('');
        
        document.getElementById('result').innerHTML = `<ul>${htmlList}</ul>`;
    } else {
        document.getElementById('result').innerText = "there is no search result.";
    }
});