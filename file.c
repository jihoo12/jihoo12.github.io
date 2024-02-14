#include <stdio.h>
int main(int argc,char * argv[]) {
	FILE *file = fopen(argv[1],"r");
	if (file == NULL) {
		printf("%s not found",argv[1]);
		return 1;
	}
	char buffer[100];
	while (fgets(buffer,sizeof(buffer),file) != NULL) {
		printf("%s\n",buffer);
	}
	fclose(file);
	return 0;
}
