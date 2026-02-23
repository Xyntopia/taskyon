describe('dockview keepAliveViews', () => {
  it('keeps a configured view mounted while minimized', () => {
    cy.visit('/dockview')

    cy.dataCy('dock-tab-panel-KeepAliveTicker').click()

    cy.dataCy('keepalive-mount-id')
      .invoke('text')
      .then((text) => {
        cy.wrap(text.trim()).as('mountId')
      })

    cy.dataCy('keepalive-ticks')
      .invoke('text')
      .then((text) => {
        const tickCount = Number.parseInt(text.trim(), 10)
        expect(tickCount).to.be.gte(0)
        cy.wrap(tickCount).as('tickBeforeMinimize')
      })

    cy.dataCy('dock-minimize-panel').click()
    cy.wait(1200)

    cy.dataCy('dock-tab-panel-KeepAliveTicker').click()

    cy.get('@mountId').then((mountId) => {
      cy.dataCy('keepalive-mount-id').invoke('text').should('eq', mountId)
    })

    cy.get('@tickBeforeMinimize').then((tickBeforeMinimize) => {
      cy.dataCy('keepalive-ticks')
        .invoke('text')
        .then((text) => {
          const tickAfterMinimize = Number.parseInt(text.trim(), 10)
          expect(tickAfterMinimize).to.be.greaterThan(Number(tickBeforeMinimize))
        })
    })
  })
})
