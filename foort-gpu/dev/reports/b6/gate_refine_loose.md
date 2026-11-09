# Quality gate: refine_loose vs Reference (512², code 48a078bd6a71)

High with adaptive refinement from stride 4: interpolation error sky 0.3 px, r 3e-3, g 3e-3, dt 0.3 M.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 100.000% | 4.8e-2 / 1.5e+0 | 2.7e-4 / 6.4e-4 / 8.0e-4 / 7.5e-4 | 1.4e-2 | 3.8e-5 | 1.4e-1 | 1.000000 | 6.3e-4 | 0.0e+0 | 1.55× |
| kerr_a0_inc80 | 0.00% | 100.000% | 6.0e-2 / 1.5e+0 | 1.2e-3 / 1.8e-3 / 1.8e-3 / 1.9e-3 | 2.4e-2 | 9.5e-4 | 1.0e-1 | 1.000000 | 1.7e-4 | 0.0e+0 | 2.68× |
| kerr_a0.94_inc17 | 0.00% | 100.000% | 4.7e-2 / 1.5e+0 | 2.1e-4 / 5.9e-4 / 7.1e-4 / 7.2e-4 | 1.3e-2 | 4.2e-5 | 1.5e-1 | 1.000000 | -2.4e-4 | 1.7e-1 | 1.79× |
| kerr_a0.94_inc80 | 0.01% | 100.000% | 6.6e-2 / 2.0e+0 | 8.9e-4 / 1.7e-3 / 1.9e-3 / 1.7e-3 | 2.4e-2 | 9.8e-4 | 1.1e-1 | 1.000000 | -6.2e-4 | 0.0e+0 | 1.74× |
| kerr_a0.998_inc80 | 0.02% | 100.000% | 6.7e-2 / 2.5e+0 | 9.1e-4 / 1.7e-3 / 1.9e-3 / 1.7e-3 | 2.5e-2 | 9.2e-4 | 1.2e-1 | 1.000000 | -5.0e-4 | 0.0e+0 | 1.53× |
| johannsen_a0.94_a13_5.5 | 0.00% | 100.000% | 4.7e-2 / 1.5e+0 | 3.1e-4 / 7.2e-4 / 9.4e-4 / 8.9e-4 | 1.6e-2 | 7.1e-5 | 1.6e-1 | 1.000000 | -4.0e-4 | 0.0e+0 | 1.80× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.997% | 4.9e-2 / 1.5e+0 | 2.8e-4 / 6.4e-4 / 9.2e-4 / 1.0e-3 | 1.7e-2 | 2.1e-4 | 1.9e-1 | 1.000000 | -1.6e-5 | 0.0e+0 | 1.70× |
| rn_Q0.8_inc60 | 0.01% | 100.000% | 5.5e-2 / 1.5e+0 | 6.2e-4 / 8.5e-4 / 1.2e-3 / 1.2e-3 | 1.7e-2 | 4.9e-4 | 3.0e-1 | 1.000000 | -2.8e-3 | 0.0e+0 | 1.27× |
| st3cr_l0.05 | 2.09% | 99.986% | 4.8e-2 / 8.2e-1 | 3.9e-4 / 6.9e-4 / 4.7e-4 / 6.3e-5 | 7.5e-3 | 5.3e-4 | 9.8e-3 | 1.000000 | 1.3e-6 | 2.9e-2 | 1.74× |
| st3cr_l5e-3 | 3.30% | 98.689% | 5.6e-2 / 8.6e-1 | 5.2e-4 / 7.9e-4 / 6.3e-4 / 1.3e-4 | 9.0e-3 | 7.1e-4 | 1.1e-2 | 1.000000 | 8.9e-6 | 4.6e-1 | 2.26× |
| st3cr_l1e-3 | 2.47% | 97.583% | 6.5e-2 / 9.3e-1 | 5.2e-4 / 7.6e-4 / 6.2e-4 / 1.3e-4 | 9.3e-3 | 6.9e-4 | 1.1e-2 | 1.000000 | 1.0e-5 | 4.3e-1 | 2.02× |
| st3cr_l1e-4 | 3.04% | 97.517% | 8.3e-2 / 1.1e+0 | 5.5e-4 / 7.8e-4 / 7.0e-4 / 1.4e-4 | 1.0e-2 | 7.1e-4 | 1.0e-2 | 1.000000 | -1.6e-5 | 4.1e-1 | 1.88× |
| st3cr_l0 | 0.07% | 100.000% | 8.5e-2 / 1.1e+0 | 5.5e-4 / 7.8e-4 / 7.1e-4 / 1.5e-4 | 1.0e-2 | 7.1e-4 | 1.2e-2 | 1.000000 | 3.1e-4 | 0.0e+0 | 1.34× |

Normal budgets passed per scene: kerr_a0_inc17: all; kerr_a0_inc80: emissionP99; kerr_a0.94_inc17: all; kerr_a0.94_inc80: emissionP99; kerr_a0.998_inc80: emissionP99; johannsen_a0.94_a13_5.5: all; mankoNovikov_a0.94_a3_2: all; rn_Q0.8_inc60: all; st3cr_l0.05: chaoticFractions; st3cr_l5e-3: classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: classAgreement, chaoticFractions; st3cr_l0: all
