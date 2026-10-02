// Modelica sources shared by the editor and runtime diagnostics.
export const exampleModels = {
  bouncingBall: `model BouncingBall             "The bouncing ball model"
  constant Real g(unit = "m/s2") = 9.81 "Gravitational acceleration";
  parameter Real c = 0.9 "Elasticity constant of ball";
  parameter Real radius(unit = "m") = 0.1 "Radius of the ball";
  Real h(unit = "m", start = 1, fixed = true) "Height above ground of ball center";
  Real v(unit = "m/s", start = 0, fixed = true) "Velocity of the ball";
  Real E(unit = "m2/s2") "Specific mechanical energy";
 equation
  der(h) = v;
  der(v) = -g;
  E = g*h + 0.5*v*v;
  when h <= radius then
    reinit(v, -c*pre(v));
  end when;
 annotation(experiment(StartTime = 0, StopTime = 7, Interval = 0.1));
end BouncingBall;`,
  resistorMsl: `model MslResistorExample
  extends Modelica.Electrical.Analog.Examples.Resistor;
  annotation(experiment(StartTime = 0, StopTime = 5, Interval = 0.1));
end MslResistorExample;`,
  orbit: `model SatelliteOrbit2D
  parameter Real mu(unit = "km3/s2") = 398600.4418;
  parameter Real r0(unit = "km") = 7000;
  parameter Real v0(unit = "km/s") = sqrt(mu / r0);
  Real rx(unit = "km", start = r0, fixed = true);
  Real ry(unit = "km", start = 0, fixed = true);
  Real vx(unit = "km/s", start = 0, fixed = true);
  Real vy(unit = "km/s", start = v0, fixed = true);
  Real inv_r(unit = "km");
  Real inv_v2(unit = "km2/s2");
  Real inv_h(unit = "km2/s");
  Real inv_energy(unit = "km2/s2");
  Real inv_a(unit = "km");
  Real inv_rv(unit = "km2/s");
  Real inv_ex;
  Real inv_ey;
  Real inv_ecc;
equation
  der(rx) = vx;
  der(ry) = vy;
  inv_r = sqrt(rx * rx + ry * ry);
  inv_v2 = vx * vx + vy * vy;
  inv_h = rx * vy - ry * vx;
  inv_energy = 0.5 * inv_v2 - mu / inv_r;
  inv_a = 1 / (2 / inv_r - inv_v2 / mu);
  inv_rv = rx * vx + ry * vy;
  inv_ex = ((inv_v2 - mu / inv_r) * rx - inv_rv * vx) / mu;
  inv_ey = ((inv_v2 - mu / inv_r) * ry - inv_rv * vy) / mu;
  inv_ecc = sqrt(inv_ex * inv_ex + inv_ey * inv_ey);
  der(vx) = -mu * rx / (inv_r ^ 3);
  der(vy) = -mu * ry / (inv_r ^ 3);
  annotation(experiment(StartTime = 0, StopTime = 6000, Interval = 20));
end SatelliteOrbit2D;`,
  drivenPendulumPhaseMap: `model DrivenPendulumPhaseMap
  parameter Real delta = 0.2 "Linear damping";
  parameter Real driveAmp(unit = "rad/s2") = 1.2 "Drive amplitude";
  parameter Real driveOmega(unit = "rad/s") = 2/3 "Drive angular frequency";
  Real theta(unit = "rad", start = 0.2, fixed = true) "Angle";
  Real omega(unit = "rad/s", start = 0.0, fixed = true) "Angular velocity";
  Real phaseEnergy(unit = "rad2/s2") "Kinetic + potential-like scalar for color mapping";
equation
  der(theta) = omega;
  der(omega) = -sin(theta) - delta * omega + driveAmp * sin(driveOmega * time);
  phaseEnergy = 0.5 * omega * omega + (1 - cos(theta));
  annotation(experiment(StartTime = 0, StopTime = 200, Interval = 0.02));
end DrivenPendulumPhaseMap;`,
} as const
