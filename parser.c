#include <stdio.h>
int main(int argc,char * argv[]) {
	FILE *file = fopen(argv[1],"r");
	if (file == NULL) {
		printf("%s not found",argv[1]);
		return 1;
	}
	char buffer[100];
	int a = 0;
	while (fgets(buffer,sizeof(buffer),file) != NULL) {
		a++;
		if (strcmp(buffer,"print") == 0){
			printf("hello");
		}else
			printf("%s%d",buffer,a);
	}
	fclose(file);
	return 0;
}
