# Quality gate: bs3_tol1 vs Reference (512², code 48a078bd6a71)

High with the Bogacki-Shampine 3(2) integrator, tolerance 1 pixel angles, steps capped at 4x FOORT's rule.

| scene | chaos | class agr. | sky px med / p99 | emission L1 (avg / t₀ / t₁ / t₂) | p99 rel (worst) | flux (worst) | dt p99 (M) | LC corr | chaotic flux | class-frac Δ | speed-up |
|---|---|---|---|---|---|---|---|---|---|---|---|
| kerr_a0_inc17 | 0.00% | 99.983% | 1.6e-2 / 1.7e-1 | 9.1e-4 / 1.4e-2 / 1.4e-2 / 1.1e-2 | 5.3e-2 | 1.7e-3 | 1.0e+0 | 0.999962 | -5.5e-3 | 0.0e+0 | 2.52× |
| kerr_a0_inc80 | 0.00% | 99.984% | 1.5e-2 / 1.7e-1 | 2.3e-3 / 1.4e-2 / 1.6e-2 / 1.3e-2 | 4.7e-2 | 4.8e-3 | 2.1e-1 | 0.999813 | -1.1e-3 | 0.0e+0 | 2.98× |
| kerr_a0.94_inc17 | 0.00% | 99.996% | 2.6e-2 / 1.9e-1 | 8.7e-4 / 1.4e-2 / 1.5e-2 / 1.2e-2 | 5.6e-2 | 1.5e-3 | 8.4e-1 | 0.999961 | 2.3e-3 | 0.0e+0 | 2.22× |
| kerr_a0.94_inc80 | 0.01% | 99.996% | 2.0e-2 / 2.9e-1 | 1.3e-3 / 1.4e-2 / 1.5e-2 / 1.4e-2 | 5.0e-2 | 3.9e-3 | 1.9e-1 | 0.999911 | 8.5e-4 | 0.0e+0 | 2.72× |
| kerr_a0.998_inc80 | 0.02% | 99.999% | 2.1e-2 / 3.1e-1 | 1.3e-3 / 1.4e-2 / 1.6e-2 / 1.5e-2 | 4.9e-2 | 3.8e-3 | 2.0e-1 | 0.999911 | 8.2e-4 | 0.0e+0 | 2.45× |
| johannsen_a0.94_a13_5.5 | 0.00% | 99.990% | 2.4e-2 / 2.5e-1 | 1.0e-3 / 1.4e-2 / 1.4e-2 / 1.1e-2 | 5.1e-2 | 1.6e-3 | 1.4e+0 | 0.999959 | 3.7e-3 | 0.0e+0 | 3.29× |
| mankoNovikov_a0.94_a3_2 | 0.01% | 99.990% | 2.4e-2 / 2.4e-1 | 9.1e-4 / 1.3e-2 / 1.7e-2 / 1.2e-2 | 5.8e-2 | 1.9e-3 | 9.8e-1 | 0.999937 | 4.3e-4 | 3.7e-2 | 3.61× |
| rn_Q0.8_inc60 | 0.01% | 99.998% | 1.5e-2 / 1.8e-1 | 1.4e-3 / 1.2e-2 / 1.4e-2 / 1.2e-2 | 4.8e-2 | 3.2e-3 | 8.2e-1 | 0.999922 | 2.1e-2 | 0.0e+0 | 1.94× |
| st3cr_l0.05 | 2.09% | 99.935% | 2.8e-1 / 5.0e+0 | 6.3e+0 / 3.0e+0 / 4.9e+0 / 2.5e+0 | 4.8e-1 | 8.7e+0 | 6.2e-2 | 0.479981 | 8.1e+0 | 3.7e-2 | 2.00× |
| st3cr_l5e-3 | 3.30% | 97.515% | 3.1e-1 / 6.7e+0 | 3.5e-3 / 2.6e-3 / 8.7e-3 / 9.1e-3 | 6.7e-1 | 7.9e-4 | 2.8e-1 | 1.000000 | 5.6e-3 | 1.2e-1 | 1.46× |
| st3cr_l1e-3 | 2.47% | 94.661% | 3.5e-1 / 4.9e+0 | 2.4e-3 / 3.1e-3 / 1.1e-2 / 6.3e-3 | 3.0e-1 | 9.6e-4 | 1.8e+0 | 1.000000 | -1.7e-3 | 9.9e-2 | 1.62× |
| st3cr_l1e-4 | 3.04% | 92.727% | 3.8e-1 / 3.8e+0 | 2.4e-3 / 2.3e-3 / 6.8e-3 / 9.7e-3 | 5.9e-1 | 9.5e-4 | 1.7e+1 | 1.000000 | -2.8e-3 | 9.4e-2 | 1.13× |
| st3cr_l0 | 0.07% | 100.000% | 3.7e-1 / 3.6e+0 | 6.4e-4 / 1.0e-3 / 8.1e-4 / 7.4e-4 | 4.9e-3 | 9.0e-4 | 2.1e-2 | 1.000000 | -3.4e-4 | 0.0e+0 | 3.69× |

Normal budgets passed per scene: kerr_a0_inc17: emissionL1, emissionP99, dt; kerr_a0_inc80: emissionL1, emissionP99, flux; kerr_a0.94_inc17: emissionL1, emissionP99, dt; kerr_a0.94_inc80: emissionL1, emissionP99, flux; kerr_a0.998_inc80: emissionL1, emissionP99, flux; johannsen_a0.94_a13_5.5: emissionL1, emissionP99, dt; mankoNovikov_a0.94_a3_2: emissionL1, emissionP99, dt; rn_Q0.8_inc60: emissionL1, emissionP99, flux, dt; st3cr_l0.05: emissionL1, emissionP99, flux, lightCurve, chaoticFlux, chaoticFractions; st3cr_l5e-3: emissionL1, emissionP99, classAgreement, chaoticFractions; st3cr_l1e-3: emissionL1, emissionP99, dt, classAgreement, chaoticFractions; st3cr_l1e-4: emissionL1, emissionP99, dt, classAgreement, chaoticFractions; st3cr_l0: all
