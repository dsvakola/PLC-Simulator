# PLC Simulator - project brief

Owner: Prof. Dattaraj S. Vidyasagar and Prof. Yash D. Vidyasagar, Vidyasagar Academy.

Goal: an offline Windows desktop simulator for PLC programming for students, teachers and hobbyists, similar in spirit to Siemens-style PLCs (LOGO!, S7-200/1200/1500 style CPUs, all types) but NOT using Siemens trademarks, logos, file formats or software, and not copying any Siemens files (name suggestion: VSA PLC Simulator; identifier in.edu.vsa.plcsimulator; own look and feel, own menus, different from the VSA Simulator circuit app).

Stack and rules: Tauri v2 + Rust + vanilla TypeScript strict, Vite, pnpm, no Node at runtime; Release folder + build.bat; version starts at 0.0.1 and increases with every change; GPL 3.0; per-monitor DPI sharp graphics (SVG for logos/icons); commit as dsvakola with no co-author lines; no mention of any AI assistant or its maker anywhere in project files; address the Professor as Professor; one step at a time and wait for his go-ahead; never install anything on his PC without his explicit yes.

Existing engine: crates\plc-core (ladder engine from the circuit simulator, reuse and extend).

Ideas discussed earlier: ladder diagram (LAD) editor with live power flow, function block diagram (FBD), statement list / structured text, timers (TON, TOF, TP), counters (CTU, CTD), comparators, math, memory bits, an 8-in / 8-out compact PLC with 24 V I/O, simulated field devices (push buttons, switches, limit switches, lamps, motors, contactors, conveyors, tank level), HMI-style panels, examples with detailed human-style comments, in-app Help, Store-ready MSIX later.

First task for the new project: study the copied files, report a plan and a list of questions, then wait for approval.
