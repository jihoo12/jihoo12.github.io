{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {
  buildInputs = [
    pkgs.nodejs_24 
  ];

  shellHook = ''
    echo "nodejs shell.nix"
    node --version
    npm --version
  '';
}