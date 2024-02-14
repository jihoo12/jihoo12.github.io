use strict;
use warnings;

# 파일 열기
open(my $파일핸들, '<', 'list.txt') or die "파일 열기 실패: $!";

# 결과를 저장할 변수 초기화
my $결과 = '';

# 파일 내용을 한 줄씩 읽어오며 처리
while (my $줄 = <$파일핸들>) {
    chomp $줄;  # 개행 문자 제거

    # value를 <a href="value">value</a>로 바꾸기
    my $변환된줄 = qq{<a href="$줄">$줄</a>};

    # 결과에 변환된 줄 추가
    $결과 .= $변환된줄 . "\n";
}

# 파일 닫기
close($파일핸들);

# 변환된 결과 출력
print $결과;
