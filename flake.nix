{
  description = "jihoo12.github.io development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      devShells = forAllSystems (pkgs: rec {
        default = pkgs.mkShell {
          # Matches the Node.js version CI deploys with.
          packages = with pkgs; [
            git
            nodejs_24
          ];
        };
        # For rebuilding the 3D Nixchan model (tools/nixchan-3d/build.py). Kept out of the default
        # shell, since Blender is a big download that everyday work on the site doesn't need.
        blender = pkgs.mkShell {
          inputsFrom = [ default ];
          packages = pkgs.lib.optional (pkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform pkgs.blender) pkgs.blender;
        };
      });
    };
}
