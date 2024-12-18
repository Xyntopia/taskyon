export const config = {
  clientId: 'dde1b4f838875dba5671',
  redirectUri: `${window.origin}/auth/github`, // Dynamically use current origin
  scope: 'gist',
}

export async function openOAuthPopup() {
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${config.clientId}&redirect_uri=${config.redirectUri}&scope=${config.scope}`

  const popup = window.open(authUrl, 'githubOAuth', 'width=600,height=700')

  const currentOrigin = window.origin

  return new Promise((resolve, reject) => {
    // Listen for messages from the popup
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== currentOrigin) {
        console.error('Origin mismatch:', event.origin)
        return
      }

      const { token, error } = event.data
      if (token) {
        console.log('Received access token:', token)
        resolve(token)
      } else if (error) {
        console.error('Error:', error)
        reject(new Error(error))
      }

      // Close the popup
      //if (popup) popup.close();
      console.log(`closing ${popup?.origin}`)

      // Remove the event listener
      window.removeEventListener('message', handleMessage)
    }

    window.addEventListener('message', handleMessage)
  })
}
