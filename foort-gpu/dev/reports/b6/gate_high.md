# Quality gate: high vs Reference (512², code 1b1e6fd727c8)

High: Reference + the Stage 1 trades (larger steps beyond 20 M up to 4x; fuzzball max steps 5000) = the viewer since M9.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 100.000% | 2.1e-2 / 2.4e-1 | 7.0e-5 / 4.8e-4 / 5.1e-4 / 4.5e-4 | 2.3e-3 | 4.9e-5 | 1.4e-1 | 1.000000 | 6.3e-4 | 0.0e+0 | 1.08× |
| kerr_a0_inc80 | 0.00% | 100.000% | 2.1e-2 / 2.4e-1 | 2.3e-4 / 7.0e-4 / 6.8e-4 / 7.8e-4 | 2.9e-3 | 1.3e-4 | 2.6e-2 | 1.000000 | 1.7e-4 | 0.0e+0 | 1.46× |
| kerr_a0.94_inc17 | 0.00% | 100.000% | 2.9e-2 / 2.5e-1 | 5.9e-5 / 4.7e-4 / 5.2e-4 / 4.3e-4 | 2.3e-3 | 3.9e-5 | 1.4e-1 | 1.000000 | -2.4e-4 | 1.7e-1 | 1.21× |
| kerr_a0.94_inc80 | 0.01% | 100.000% | 2.4e-2 / 3.0e-1 | 9.2e-5 / 5.2e-4 / 5.8e-4 / 6.2e-4 | 2.8e-3 | 9.8e-5 | 2.9e-2 | 1.000000 | -2.2e-4 | 0.0e+0 | 1.19× |
| kerr_a0.998_inc80 | 0.02% | 100.000% | 2.4e-2 / 3.0e-1 | 8.7e-5 / 5.2e-4 / 5.9e-4 / 6.2e-4 | 2.8e-3 | 9.6e-5 | 3.6e-2 | 1.000000 | -1.4e-4 | 0.0e+0 | 1.82× |
| johannsen_a0.94_a13_5.5 | 0.00% | 100.000% | 2.5e-2 / 2.2e-1 | 8.0e-5 / 4.9e-4 / 5.8e-4 / 4.7e-4 | 2.4e-3 | 3.3e-5 | 1.6e-1 | 1.000000 | -4.0e-4 | 0.0e+0 | 1.43× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.998% | 2.8e-2 / 2.6e-1 | 7.2e-5 / 4.7e-4 / 6.0e-4 / 4.8e-4 | 2.5e-3 | 5.7e-5 | 1.8e-1 | 1.000000 | -1.4e-5 | 0.0e+0 | 1.25× |
| rn_Q0.8_inc60 | 0.01% | 100.000% | 2.4e-2 / 2.7e-1 | 1.2e-4 / 4.8e-4 / 5.4e-4 / 5.2e-4 | 2.4e-3 | 1.2e-4 | 2.7e-1 | 1.000000 | -2.8e-3 | 0.0e+0 | 1.18× |
| st3cr_l0.05 | 2.09% | 99.986% | 0.0e+0 / 0.0e+0 | 0.0e+0 / 0.0e+0 / 0.0e+0 / 0.0e+0 | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.000000 | 0.0e+0 | 2.9e-2 | 1.37× |
| st3cr_l5e-3 | 3.30% | 98.689% | 0.0e+0 / 0.0e+0 | 0.0e+0 / 0.0e+0 / 0.0e+0 / 0.0e+0 | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.000000 | 0.0e+0 | 4.6e-1 | 1.70× |
| st3cr_l1e-3 | 2.47% | 97.583% | 0.0e+0 / 0.0e+0 | 0.0e+0 / 0.0e+0 / 0.0e+0 / 0.0e+0 | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.000000 | 0.0e+0 | 4.3e-1 | 1.49× |
| st3cr_l1e-4 | 3.04% | 97.517% | 0.0e+0 / 0.0e+0 | 0.0e+0 / 0.0e+0 / 0.0e+0 / 0.0e+0 | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.000000 | 0.0e+0 | 4.1e-1 | 1.99× |
| st3cr_l0 | 0.07% | 100.000% | 0.0e+0 / 0.0e+0 | 0.0e+0 / 0.0e+0 / 0.0e+0 / 0.0e+0 | 0.0e+0 | 0.0e+0 | 0.0e+0 | 1.000000 | 0.0e+0 | 0.0e+0 | 1.05× |

Normal budgets passed per scene: kerr_a0_inc17: all; kerr_a0_inc80: all; kerr_a0.94_inc17: all; kerr_a0.94_inc80: all; kerr_a0.998_inc80: all; johannsen_a0.94_a13_5.5: all; mankoNovikov_a0.94_a3_2: all; rn_Q0.8_inc60: all; st3cr_l0.05: chaoticFractions; st3cr_l5e-3: classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: classAgreement, chaoticFractions; st3cr_l0: all
