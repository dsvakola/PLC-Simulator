# PLC & SCADA Simulator

An offline Windows program for learning PLC programming, for students,
teachers and hobbyists. Draw a program as a function block diagram (FBD),
wire field devices to the academy's PLC training panel, and simulate it:
the PLC runs scan by scan in real time, lamps light, motors turn, and the
wires that are on turn red.

Developed by Prof. Dattaraj S. Vidyasagar & Prof. Yash D. Vidyasagar, for
Vidyasagar Academy.
Website: https://vsa.edu.in/software/ · E-mail: softinquiry@vsa.edu.in

## What it does

- **Program**: function block diagram with inputs, outputs, markers, logic
  gates, timers (on-delay, off-delay, on/off-delay, weekly, yearly) and
  analog blocks. Wires run at right angles and can be rearranged.
- **Control Panel**: the academy's board (lamps Q1-Q4, switches I1-I4, the
  Q and I connectors, the PLC module), wired inside, plus push buttons,
  sensors, a potentiometer, a PT100, lamps, buzzer, hooter, motor and
  contactor that the student places and wires.
- **Simulate**: real-time scan cycle in Rust, following the student's wiring
  (short circuits switch the supply off), with a simulated clock for the
  weekly and yearly timers.

## Building

Needs Rust (https://rustup.rs) and Node.js (https://nodejs.org). Double-click
`build.bat`. The installer and a portable folder appear in `Release`.
For the Microsoft Store package, run `msix.bat` after `build.bat`.

## Folders

- `src` - the window (TypeScript, no framework)
- `src-tauri` - the program shell (Rust, Tauri 2): files, settings, links,
  and the simulation thread
- `crates/plc-core` - the PLC engine: the FBD and ladder CPUs, the control
  panel and its electrics, the simulation, and the project file

## Licence

GNU General Public License v3.0. See `LICENSE` and `NOTICE`.
