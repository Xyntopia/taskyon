import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { installQuasarPlugin } from '@quasar/quasar-app-extension-testing-unit-jest';
import { getVector } from 'src/modules/nlp';

//import { mount, shallowMount } from '@vue/test-utils';
//import { QBtn } from 'quasar';
//import MyButton from './demo/MyButton';

// Specify here Quasar config you'll need to test your component
installQuasarPlugin();

/*
describe('MyButton', () => {
  it('has increment method', () => {
    const wrapper = mount(MyButton);
    const { vm } = wrapper;

    expect(typeof vm.increment).toBe('function');
  });
*/

describe('vector calculation', () => {
  const vectorizerModel = 'Xenova/all-MiniLM-L6-v2';

  it('should create vectors from a short text', async () => {
    const shortText = 'hello is there anybody here?';
    const vec = await getVector(shortText, vectorizerModel);
  });

  it('should create vectors from a long text', async () => {
    const longText = `A rocket (from Italian: rocchetto, lit. 'bobbin/spool')[nb 1][1]
     is a vehicle that uses jet propulsion to accelerate without using the surrounding air.
      A rocket engine produces thrust by reaction to exhaust expelled at high speed.[2] Rocket
       engines work entirely from propellant carried within the vehicle; therefore a rocket can
        fly in the vacuum of space. Rockets work more efficiently
     in a vacuum and incur a loss of thrust due to the opposing pressure of the atmosphere.
    Multistage rockets are capable of attaining escape velocity from Earth and therefore can 
    achieve unlimited maximum altitude. Compared with airbreathing engines, rockets are lightweight
     and powerful and capable of generating large accelerations. To control their flight, rockets rely on momentum, airfoils, auxiliary reaction engines, gimballed thrust, momentum wheels, deflection of the exhaust stream, propellant flow, spin, or gravity.
    Rockets for military and recreational uses date back to at least 13th-century China.[3] 
    Significant scientific, interplanetary and industrial use did not occur until the 20th
     century, when rocketry was the enabling technology for the Space Age, including setting
      foot on the Moon. Rockets are now used for fireworks, missiles and other weaponry, 
      ejection seats, launch vehicles for artificial satellites, human spaceflight, and space exploration.
    Chemical rockets are the most common type of high power rocket, typically creating a
     high speed exhaust by the combustion of fuel with an oxidizer. The stored propellant 
     can be a simple pressurized gas or a single liquid fuel that disassociates in the 
     presence of a catalyst (monopropellant), two liquids that spontaneously react on 
     contact (hypergolic propellants), two liquids that must be ignited to react (like
       kerosene (RP1) and liquid oxygen, used in most liquid-propellant rockets), a solid
        combination of fuel with oxidizer (solid fuel), or solid fuel with liquid or 
        gaseous oxidizer (hybrid propellant system). Chemical rockets store a large
         amount of energy in an easily released form, and can be very dangerous. However, 
         careful design, testing, construction and use minimizes risks.[citation needed]
    `;
    const vec = await getVector(longText, vectorizerModel);
  });
});
