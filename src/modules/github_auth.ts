

export function openOAuthPopup() {
  const clientId = 'dde1b4f838875dba5671';
  const redirectUri = `${window.origin}/auth/github/callback`; // Dynamically use current origin
  const scope = 'gist';
  const authUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=${scope}`;

  const popup = window.open(authUrl, 'githubOAuth', 'width=600,height=700');

  const currentOrigin = window.origin;

  // Listen for messages from the popup
  window.addEventListener('message', (event) => {
    if (event.origin !== currentOrigin) {
      console.error('Origin mismatch:', event.origin);
      return;
    }

    const { token, error } = event.data;
    if (token) {
      console.log('Received access token:', token);
      // Use the token to create a gist or store it
    } else if (error) {
      console.error('Error:', error);
    }

    // Close the popup
    if (popup) popup.close();
  });
}
