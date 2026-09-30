//! Builds the program's IDL the way `anchor idl build` (Anchor 1.2) does, with the same library
//! and options, but without the Anchor CLI or the Solana toolchain:
//!
//! ```text
//! cargo run -p leash --example idl -- --write   # updates packages/contracts/idl/leash.json
//! cargo run -p leash --example idl -- --check   # fails if the committed IDL is stale (CI)
//! ```

use std::{env, fs, path::Path, process::ExitCode};

use anchor_lang_idl::build::IdlBuilder;

fn main() -> ExitCode {
    let mode = env::args().nth(1).unwrap_or_default();
    if mode != "--write" && mode != "--check" {
        eprintln!("usage: cargo run -p leash --example idl -- --write | --check");
        return ExitCode::FAILURE;
    }
    let program = Path::new(env!("CARGO_MANIFEST_DIR"));
    let committed = program.join("../../packages/contracts/idl/leash.json");

    // anchor-lang-idl 0.1.4 turns RUSTUP_TOOLCHAIN into a malformed `+{toolchain}` argument.
    // The nested cargo finds the same toolchain through rust-toolchain.toml without it.
    env::remove_var("RUSTUP_TOOLCHAIN");
    let idl = match IdlBuilder::new()
        .program_path(program.to_path_buf())
        .resolution(true)
        .skip_lint(false)
        .no_docs(false)
        .build()
    {
        Ok(idl) => idl,
        Err(error) => {
            eprintln!("building the IDL failed: {error:#}");
            return ExitCode::FAILURE;
        }
    };
    // Byte for byte what `anchor build` writes to target/idl/leash.json.
    let json = serde_json::to_string_pretty(&idl).expect("the IDL serializes");

    if mode == "--write" {
        if let Err(error) = fs::write(&committed, &json) {
            eprintln!("writing {}: {error}", committed.display());
            return ExitCode::FAILURE;
        }
        println!("wrote {}", committed.display());
        return ExitCode::SUCCESS;
    }
    match fs::read_to_string(&committed) {
        Ok(current) if current == json => {
            println!("{} matches the program", committed.display());
            ExitCode::SUCCESS
        }
        Ok(_) => {
            eprintln!(
                "{} is stale: run `cargo run -p leash --example idl -- --write` and commit it",
                committed.display()
            );
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("reading {}: {error}", committed.display());
            ExitCode::FAILURE
        }
    }
}
