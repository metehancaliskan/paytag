#![no_std]
use soroban_sdk::{contract, contractimpl, symbol_short, Env, Symbol};

#[contract]
pub struct PaytagEscrow;

#[contractimpl]
impl PaytagEscrow {
    /// Toolchain smoke test. Faz 2'de gerçek fonksiyonlarla değişecek.
    pub fn ping(_env: Env) -> Symbol {
        symbol_short!("paytag")
    }
}

#[cfg(test)]
mod test;
