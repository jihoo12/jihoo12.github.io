#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>

#define MAX_COMMAND_LENGTH 100
#define MAX_ARGUMENTS 10

int execute_command(char *command) {
    char *arguments[MAX_ARGUMENTS];
    int argument_count = 0;

    // 명령어 파싱
    char *token = strtok(command, " ");
    while (token != NULL && argument_count < MAX_ARGUMENTS - 1) {
        arguments[argument_count] = token;
        argument_count++;
        token = strtok(NULL, " ");
    }
    arguments[argument_count] = NULL;

    // 내장 명령어 처리
    if (strcmp(arguments[0], "exit") == 0) {
        exit(0);
    }

    // 프로세스 실행
    pid_t pid = fork();
    if (pid < 0) {
        perror("fork");
        return -1;
    } else if (pid == 0) {
        // 자식 프로세스
        execvp(arguments[0], arguments);
        perror("execvp");
        exit(1);
    } else {
        // 부모 프로세스
        int status;
        waitpid(pid, &status, 0);
        if (WIFEXITED(status)) {
            return WEXITSTATUS(status);
        } else {
            return -1;
        }
    }
}

int main() {
    char command[MAX_COMMAND_LENGTH];

    while (1) {
        printf(":> ");
        fgets(command, MAX_COMMAND_LENGTH, stdin);

        // 개행 문자 제거
        command[strcspn(command, "\n")] = '\0';

        // 명령어 실행
        int result = execute_command(command);
        if (result == -1) {
            printf("명령어 실행 중 오류가 발생했습니다.\n");
        }
    }

    return 0;
}
