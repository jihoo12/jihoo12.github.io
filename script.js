
const toggleBtn = document.getElementById('theme-toggle');
const body = document.body;
const icon = toggleBtn.querySelector('.icon');

// 사용자의 기존 설정을 확인 (로컬 스토리지)
const currentTheme = localStorage.getItem('theme');
if (currentTheme === 'dark') {
    body.classList.add('dark-mode');
    icon.textContent = '🌙';
}

toggleBtn.addEventListener('click', () => {
    // 클래스 토글
    body.classList.toggle('dark-mode');

    // 상태에 따라 아이콘 변경 및 저장
    if (body.classList.contains('dark-mode')) {
        icon.textContent = '🌙';
        localStorage.setItem('theme', 'dark');
    } else {
        icon.textContent = '☀️';
        localStorage.setItem('theme', 'light');
    }
});