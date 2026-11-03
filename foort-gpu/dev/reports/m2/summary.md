| case | mode | pixels | four-colour agreement | pass-count agreement | escape-direction diff median / p99 / max (rad) | steps/ray | CPU s | capture/escape confusion (FOORT→CPU, off-diagonal) |
|---|---|---|---|---|---|---|---|---|
| kerr_a0 | parity | 16384 | 100.000% (0) | 99.951% (8) | 4.7e-7 / 1.9e-5 / 9.1e-4 | 609 | 15 | none |
| kerr_a0 | app | 16384 | 100.000% (0) | 99.719% (46) | 5.9e-5 / 2.1e-4 / 8.8e-4 | 685 | 16 | none |
| kerr_a0.94 | parity | 16384 | 100.000% (0) | 100.000% (0) | 4.7e-7 / 2.2e-5 / 3.3e-3 | 693 | 18 | none |
| kerr_a0.94 | app | 16384 | 100.000% (0) | 99.945% (9) | 5.7e-5 / 2.0e-4 / 3.3e-3 | 758 | 20 | none |
| johannsen | parity | 16384 | 100.000% (0) | 100.000% (0) | 5.6e-7 / 3.0e-5 / 7.2e-4 | 661 | 19 | none |
| johannsen | app | 16384 | 99.994% (1) | 99.933% (11) | 6.2e-5 / 2.1e-4 / 7.3e-4 | 745 | 21 | none |
| mankoNovikov | parity | 16384 | 99.994% (1) | 99.994% (1) | 5.4e-7 / 3.0e-5 / 1.8e-2 | 601 | 55 | escape->horizon 1 |
| mankoNovikov | app | 16384 | 100.000% (0) | 99.890% (18) | 5.6e-5 / 2.1e-4 / 5.1e-2 | 639 | 52 | none |
| st3cr_l0.005 | parity | 4096 | 94.678% (218) | 93.872% (251) | 4.2e-7 / 8.9e-1 / 2.9e+0 | 1144 | 616 | other->escape 61, escape->other 71, escape->horizon 42, other->horizon 9 |
| st3cr_l0.005 | app | 4096 | 94.727% (216) | 93.652% (260) | 4.2e-7 / 8.5e-1 / 2.9e+0 | 1118 | 483 | other->escape 58, escape->other 79, escape->horizon 41, other->horizon 8 |
