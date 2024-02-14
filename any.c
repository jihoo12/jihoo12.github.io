#include <stdio.h>
int main() {
	char c[100];
	scanf("%s",c);
	if (strcmp(c,"hello") == 0) {
		printf("%s\n",c);
	}
}
