#include <stdio.h>
#include <termios.h>
#include <unistd.h>

void enableRawMode() {
    struct termios raw;
    tcgetattr(STDIN_FILENO, &raw);
    raw.c_lflag &= ~(ECHO | ICANON);
    tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
}

int main() {
    enableRawMode();

    char c;
    while (read(STDIN_FILENO, &c, 1) == 1) {
        if (c == '\b') {
            // 커서를 왼쪽으로 이동
            printf("\b \b");
        } else if (c == 'q') {
            break;
        } else {
            printf("%c", c);
        }
    }

    return 0;
}
