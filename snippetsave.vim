function! s:snippet_save(file, name)
  let file = '~/.vim/UltiSnips' . a:file
  let selected_text = getline("'<", "'>")

  " 홈 디렉토리를 확장하여 절대 경로로 변경합니다.
  let expanded_file = expand(file)

  " 파일이 존재하지 않는 경우 빈 파일을 생성합니다.
  if !filereadable(expanded_file)
    call writefile([], expanded_file)
  endif

  " Ultisnippet과 관련된 수정을 추가합니다.
  call writefile(["snippet " . a:name], expanded_file, 'a')
  call writefile(selected_text, expanded_file, 'a')
  call writefile(["endsnippet"], expanded_file, 'a')
endfunction

call s:snippet_save('yoursnippetfile', 'snippetname')