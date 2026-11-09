# Quality gate: refine_tight vs Reference (512², code 48a078bd6a71)

High with adaptive refinement from stride 4: interpolation error sky 0.1 px, r 1e-3, g 1e-3, dt 0.1 M.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 100.000% | 4.8e-2 / 1.5e+0 | 2.7e-4 / 6.4e-4 / 7.9e-4 / 7.5e-4 | 1.2e-2 | 4.0e-5 | 1.4e-1 | 1.000000 | 6.3e-4 | 0.0e+0 | 1.63× |
| kerr_a0_inc80 | 0.00% | 100.000% | 5.2e-2 / 1.5e+0 | 5.6e-4 / 1.1e-3 / 1.2e-3 / 1.3e-3 | 2.2e-2 | 3.2e-4 | 8.8e-2 | 1.000000 | 1.7e-4 | 0.0e+0 | 1.78× |
| kerr_a0.94_inc17 | 0.00% | 100.000% | 4.7e-2 / 1.5e+0 | 2.0e-4 / 5.8e-4 / 7.0e-4 / 7.2e-4 | 1.3e-2 | 4.2e-5 | 1.4e-1 | 1.000000 | -2.4e-4 | 1.7e-1 | 1.41× |
| kerr_a0.94_inc80 | 0.01% | 100.000% | 5.5e-2 / 1.5e+0 | 3.8e-4 / 9.6e-4 / 9.3e-4 / 1.2e-3 | 2.2e-2 | 4.3e-4 | 9.0e-2 | 1.000000 | -2.2e-4 | 0.0e+0 | 1.56× |
| kerr_a0.998_inc80 | 0.02% | 100.000% | 5.5e-2 / 1.5e+0 | 3.7e-4 / 9.6e-4 / 9.4e-4 / 1.2e-3 | 2.1e-2 | 4.2e-4 | 9.3e-2 | 1.000000 | -1.4e-4 | 0.0e+0 | 1.26× |
| johannsen_a0.94_a13_5.5 | 0.00% | 100.000% | 4.6e-2 / 1.5e+0 | 3.1e-4 / 7.2e-4 / 9.4e-4 / 8.9e-4 | 1.6e-2 | 7.3e-5 | 1.6e-1 | 1.000000 | -4.0e-4 | 0.0e+0 | 1.43× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.997% | 4.8e-2 / 1.5e+0 | 2.2e-4 / 5.9e-4 / 7.8e-4 / 7.5e-4 | 1.4e-2 | 8.0e-5 | 1.8e-1 | 1.000000 | -1.6e-5 | 0.0e+0 | 1.40× |
| rn_Q0.8_inc60 | 0.01% | 100.000% | 4.9e-2 / 7.9e-1 | 4.2e-4 / 7.3e-4 / 9.5e-4 / 8.5e-4 | 1.2e-2 | 1.8e-4 | 2.7e-1 | 1.000000 | -2.8e-3 | 0.0e+0 | 1.51× |
| st3cr_l0.05 | 2.09% | 99.986% | 0.0e+0 / 3.2e-1 | 1.1e-4 / 2.2e-4 / 1.4e-4 / 1.2e-5 | 4.2e-3 | 1.8e-4 | 1.7e-3 | 1.000000 | 7.5e-7 | 2.9e-2 | 1.03× |
| st3cr_l5e-3 | 3.30% | 98.689% | 0.0e+0 / 3.1e-1 | 1.4e-4 / 2.5e-4 / 1.8e-4 / 2.7e-5 | 4.2e-3 | 2.3e-4 | 1.6e-3 | 1.000000 | 0.0e+0 | 4.6e-1 | 1.50× |
| st3cr_l1e-3 | 2.47% | 97.583% | 0.0e+0 / 3.3e-1 | 1.3e-4 / 2.2e-4 / 1.6e-4 / 2.5e-5 | 4.2e-3 | 2.1e-4 | 1.4e-3 | 1.000000 | 0.0e+0 | 4.3e-1 | 1.45× |
| st3cr_l1e-4 | 3.04% | 97.517% | 0.0e+0 / 3.6e-1 | 1.4e-4 / 2.3e-4 / 1.9e-4 / 2.8e-5 | 4.2e-3 | 2.2e-4 | 1.4e-3 | 1.000000 | 0.0e+0 | 4.1e-1 | 1.56× |
| st3cr_l0 | 0.07% | 100.000% | 0.0e+0 / 3.6e-1 | 1.4e-4 / 2.4e-4 / 1.9e-4 / 2.8e-5 | 4.3e-3 | 2.3e-4 | 2.5e-3 | 1.000000 | 0.0e+0 | 0.0e+0 | 0.98× |

Normal budgets passed per scene: kerr_a0_inc17: all; kerr_a0_inc80: emissionP99; kerr_a0.94_inc17: all; kerr_a0.94_inc80: emissionP99; kerr_a0.998_inc80: emissionP99; johannsen_a0.94_a13_5.5: all; mankoNovikov_a0.94_a3_2: all; rn_Q0.8_inc60: all; st3cr_l0.05: chaoticFractions; st3cr_l5e-3: classAgreement, chaoticFractions; st3cr_l1e-3: classAgreement, chaoticFractions; st3cr_l1e-4: classAgreement, chaoticFractions; st3cr_l0: all
