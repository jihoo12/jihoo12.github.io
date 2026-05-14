{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_24  
    pkgs.nodePackages.npm 
  ];

  # 쉘이 시작될 때 실행될 스크립트 (선택 사항)
  shellHook = ''
    echo "nodejs shell.nix"
    node --version
  '';
}