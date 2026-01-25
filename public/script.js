// Startup Debate Room - Frontend Logic

// ============================================
// CONSTANTS
// ============================================
const MAX_FREE_ROUNDS = 3; // Set to 10 for production
const MAX_FREE_FILES = 1;  // Free users can only upload 1 file
const MAX_PREMIUM_FILES = 10; // Premium users get 10 files
const MAX_FILE_SIZE_MB = 5;
const ALLOWED_FILE_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', // Images
  'application/pdf',                                      // PDFs
  'text/plain',                                           // .txt
  'text/rtf', 'application/rtf'                          // .rtf
];


function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text ?? '');
  return div.innerHTML;
}

// ============================================
// FILE MANAGER
// ============================================

class FileManager {
  constructor() {
    this.files = []; // Array of { file, type, content, description, status }
    this.init();
  }

  init() {
    this.dropzone = document.getElementById('uploadDropzone');
    this.fileInput = document.getElementById('fileInput');
    this.previewsContainer = document.getElementById('filePreviews');
    this.limitHint = document.getElementById('fileLimitHint');

    if (!this.dropzone) return;

    // Click to upload
    this.dropzone.addEventListener('click', () => this.fileInput.click());

    // File input change
    this.fileInput.addEventListener('change', (e) => {
      this.handleFiles(e.target.files);
      this.fileInput.value = ''; // Reset for same file re-upload
    });

    // Drag and drop
    this.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropzone.classList.add('dragover');
    });

    this.dropzone.addEventListener('dragleave', () => {
      this.dropzone.classList.remove('dragover');
    });

    this.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropzone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });

    this.updateLimitHint();
  }

  getMaxFiles() {
    const auth = window.authManager;
    // explicit check for premium
    if (auth && auth.isPremium()) {
      return MAX_PREMIUM_FILES;
    }
    return MAX_FREE_FILES;
  }

  canAddMoreFiles() {
    return this.files.length < this.getMaxFiles();
  }

  handleFiles(fileList) {
    const maxFiles = this.getMaxFiles();

    for (const file of fileList) {
      // Check file limit
      if (this.files.length >= maxFiles) {
        this.showToast(`Free users can only upload ${MAX_FREE_FILES} file. Sign in for more!`, 'warning');
        break;
      }

      // Check file type
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        this.showToast(`Unsupported file type: ${file.type}`, 'error');
        continue;
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        this.showToast(`File too large (max ${MAX_FILE_SIZE_MB}MB)`, 'error');
        continue;
      }

      // Determine file type
      let fileType = 'unknown';
      if (file.type.startsWith('image/')) {
        fileType = 'image';
      } else if (file.type === 'application/pdf') {
        fileType = 'pdf';
      } else if (file.type === 'text/plain' || file.type === 'text/rtf' || file.type === 'application/rtf') {
        fileType = 'text';
      }

      // Add file
      const fileData = {
        id: Date.now() + Math.random(),
        file: file,
        type: fileType,
        name: file.name,
        content: null,
        description: null,
        status: 'processing'
      };

      this.files.push(fileData);
      this.renderPreview(fileData);
      this.processFile(fileData);
    }

    this.updateLimitHint();
  }

  renderPreview(fileData) {
    const preview = document.createElement('div');
    preview.className = 'file-preview';
    preview.dataset.id = fileData.id;

    const icons = { image: '🖼️', pdf: '📄', text: '📝' };
    const icon = icons[fileData.type] || '📎';

    preview.innerHTML = `
      <span class="file-preview-icon">${icon}</span>
      <span class="file-preview-name" title="${fileData.name}">${this.truncateName(fileData.name)}</span>
      <span class="file-preview-status processing" data-status>Processing...</span>
      <button class="file-preview-remove" title="Remove" data-remove>×</button>
    `;

    // Remove button handler
    preview.querySelector('[data-remove]').addEventListener('click', () => {
      this.removeFile(fileData.id);
    });

    this.previewsContainer.appendChild(preview);
  }

  truncateName(name) {
    if (name.length > 15) {
      const ext = name.split('.').pop();
      return name.substring(0, 10) + '...' + ext;
    }
    return name;
  }

  async processFile(fileData) {
    try {
      if (fileData.type === 'image') {
        // Convert image to base64
        const base64 = await this.fileToBase64(fileData.file);
        fileData.content = base64;

        // Try to get GPT-4 Vision description
        this.updatePreviewStatus(fileData.id, 'Analyzing...', 'processing');
        const description = await this.analyzeImage(base64);
        fileData.description = description;

        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      } else if (fileData.type === 'pdf') {
        // Extract text from PDF
        const text = await this.extractPdfText(fileData.file);
        fileData.content = text;
        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      } else if (fileData.type === 'text') {
        // Read text file directly
        const text = await this.readTextFile(fileData.file);
        fileData.content = text;
        fileData.status = 'ready';
        this.updatePreviewStatus(fileData.id, 'Ready ✓', 'ready');
      }
    } catch (error) {
      console.error('File processing error:', error);
      fileData.status = 'error';
      this.updatePreviewStatus(fileData.id, 'Error', 'error');
    }
  }

  readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async analyzeImage(base64Data) {


    try {
      const response = await fetch('/api/analyze-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          imageData: base64Data,
          context: document.getElementById('ideaInput')?.value?.trim() || ''
        })
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('Image analysis failed:', error);
        return '[Image attached]';
      }

      const data = await response.json();
      return data.description || '[Image attached]';
    } catch (error) {
      console.error('Image analysis error:', error);
      return '[Image attached]';
    }
  }

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async extractPdfText(file) {
    // Use pdf.js to extract text
    // For now, we'll use a simple approach - just note that it's a PDF
    // Full pdf.js integration can be added later
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          // Try to load pdf.js if available
          if (window.pdfjsLib) {
            const pdf = await window.pdfjsLib.getDocument({ data: reader.result }).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const content = await page.getTextContent();
              text += content.items.map(item => item.str).join(' ') + '\n';
            }
            resolve(text.trim() || '[PDF content could not be extracted]');
          } else {
            // Fallback if pdf.js not loaded
            resolve(`[PDF document: ${file.name}]`);
          }
        } catch (e) {
          console.error('PDF extraction error:', e);
          resolve(`[PDF document: ${file.name}]`);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  updatePreviewStatus(fileId, text, status) {
    const preview = this.previewsContainer.querySelector(`[data-id="${fileId}"]`);
    if (preview) {
      const statusEl = preview.querySelector('[data-status]');
      statusEl.textContent = text;
      statusEl.className = `file-preview-status ${status}`;
    }
  }

  removeFile(fileId) {
    this.files = this.files.filter(f => f.id !== fileId);
    const preview = this.previewsContainer.querySelector(`[data-id="${fileId}"]`);
    if (preview) {
      preview.style.opacity = '0';
      preview.style.transform = 'scale(0.9)';
      setTimeout(() => preview.remove(), 150);
    }
    this.updateLimitHint();
  }

  updateLimitHint() {
    const auth = window.authManager;
    const isPremium = auth && auth.isPremium();
    const isSignedIn = auth && auth.user;

    if (isPremium) {
      if (this.files.length >= MAX_PREMIUM_FILES) {
        this.limitHint.textContent = 'Maximum files reached (10/10)';
        this.limitHint.className = 'file-limit-hint warning';
      } else {
        this.limitHint.textContent = `${this.files.length}/${MAX_PREMIUM_FILES} files (Premium)`;
        this.limitHint.className = 'file-limit-hint';
      }
    } else if (this.files.length >= MAX_FREE_FILES) {
      this.limitHint.innerHTML = isSignedIn
        ? `Limit reached (1/1). <a href="#" onclick="window.authManager.handleUpgrade(); return false;">Upgrade for 10 files</a>`
        : `Limit reached (1/1). <a href="#" onclick="document.getElementById('authCard').scrollIntoView({behavior: 'smooth'}); return false;">Sign in for more</a>`;
      this.limitHint.className = 'file-limit-hint warning';
    } else {
      this.limitHint.textContent = `${this.files.length}/${MAX_FREE_FILES} file`;
      this.limitHint.className = 'file-limit-hint';
    }
  }

  getFilesForDebate() {
    // Return processed files ready for the debate
    return this.files
      .filter(f => f.status === 'ready')
      .map(f => ({
        type: f.type,
        name: f.name,
        // Use description for images, content for text/pdf
        content: f.type === 'image' ? f.description : f.content
      }));
  }

  clear() {
    this.files = [];
    this.previewsContainer.innerHTML = '';
    this.updateLimitHint();
  }

  showToast(message, type = 'info') {
    // Use AuthManager's toast if available
    if (window.authManager) {
      window.authManager.showToast(message, type);
    } else {
      alert(message);
    }
  }
}

// ============================================
// AUTH MANAGER (Supabase Email/Password)
// ============================================

class AuthManager {
  constructor() {
    this.supabase = null;
    this.user = null;
    this.profile = null; // User profile with is_premium
    this.session = null;
    this.isSignUp = false;
    this.init();
  }

  async init() {
    this.isInitializing = true; // Prevent premature UI updates

    // Fetch Supabase config from server
    try {
      const response = await fetch('/api/config');
      const config = await response.json();

      if (config.supabaseUrl && config.supabaseAnonKey) {
        this.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);

        // Check initial session FIRST
        const { data: { session } } = await this.supabase.auth.getSession();
        this.session = session;
        this.user = session?.user || null;

        // Fetch profile if logged in (before setting up listeners)
        if (this.user) {
          await this.fetchProfile();
        }

        // Listen for auth state changes AFTER initial load
        this.supabase.auth.onAuthStateChange(async (event, session) => {
          // Skip the initial SIGNED_IN event since we already handled it
          if (this.isInitializing) return;

          this.session = session;
          this.user = session?.user || null;

          // Fetch user profile when logged in
          if (this.user) {
            await this.fetchProfile();
          } else {
            this.profile = null;
          }

          this.updateUI();
        });
      } else {
        console.log('Supabase not configured');
      }
    } catch (error) {
      console.error('Failed to initialize Supabase:', error);
    }

    this.isInitializing = false; // Mark initialization complete
    this.updateUI();
    this.setupEventListeners();
    this.checkForPaymentStatus();
  }

  checkForPaymentStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('success') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
      this.showToast('🎉 Upgrade successful! Welcome to Premium!', 'success');
      // Force profile refresh
      if (this.user) this.fetchProfile();
    } else if (params.get('canceled') === 'true') {
      window.history.replaceState({}, document.title, window.location.pathname);
      this.showToast('Upgrade canceled.', 'info');
    }
  }

  async fetchProfile() {
    console.log('🔍 fetchProfile called, user:', this.user?.id);
    if (!this.user) {
      console.log('🔍 No user, setting profile to free');
      this.profile = { is_premium: false };
      return;
    }

    try {
      // Use server endpoint to bypass RLS
      const response = await fetch(`/api/profile/${this.user.id}`);

      if (!response.ok) {
        console.log('🔍 Profile fetch failed:', response.status);
        this.profile = { is_premium: false };
        return;
      }

      const data = await response.json();
      console.log('🔍 Profile fetched:', data);
      this.profile = data;
    } catch (error) {
      console.error('Failed to fetch profile:', error.message);
      this.profile = { is_premium: false };
    }
    console.log('🔍 Final profile state:', this.profile);
  }

  async createProfile() {
    if (!this.supabase || !this.user) return;

    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .insert({
          id: this.user.id,
          email: this.user.email,
          is_premium: false
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create profile:', error.message);
        this.profile = { is_premium: false };
      } else {
        this.profile = data;
      }
    } catch (error) {
      console.error('Failed to create profile:', error.message);
      this.profile = { is_premium: false };
    }
  }

  isPremium() {
    return this.profile?.is_premium === true;
  }

  setupEventListeners() {
    document.addEventListener('click', (e) => {
      // Sign In button
      if (e.target.closest('#signInBtn')) {
        e.preventDefault();
        this.handleSignIn();
      }
      // Show Sign Up
      if (e.target.closest('#showSignUp')) {
        e.preventDefault();
        this.isSignUp = true;
        this.updateUI();
      }
      // Show Sign In
      if (e.target.closest('#showSignIn')) {
        e.preventDefault();
        this.isSignUp = false;
        this.updateUI();
      }
      // Sign Up button
      if (e.target.closest('#signUpBtn')) {
        e.preventDefault();
        this.handleSignUp();
      }
      // Logout
      if (e.target.closest('#logoutBtn')) {
        e.preventDefault();
        this.handleLogout();
      }
    });

    // Enter key submits form
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target.id === 'authEmail' || e.target.id === 'authPassword')) {
        e.preventDefault();
        if (this.isSignUp) {
          this.handleSignUp();
        } else {
          this.handleSignIn();
        }
      }
    });
  }

  async handleSignIn() {
    if (!this.supabase) {
      this.showToast('Please configure Supabase first', 'error');
      return;
    }

    const email = document.getElementById('authEmail')?.value?.trim();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
      this.showToast('Please enter email and password', 'error');
      return;
    }

    const btn = document.getElementById('signInBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Signing in...';
    }

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      this.showToast('Welcome back!', 'success');
    } catch (error) {
      console.error('Sign in error:', error);
      this.showToast(error.message || 'Sign in failed', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Sign In';
      }
    }
  }

  async handleSignUp() {
    if (!this.supabase) {
      this.showToast('Please configure Supabase first', 'error');
      return;
    }

    const email = document.getElementById('authEmail')?.value?.trim();
    const password = document.getElementById('authPassword')?.value;

    if (!email || !password) {
      this.showToast('Please enter email and password', 'error');
      return;
    }

    if (password.length < 6) {
      this.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    const btn = document.getElementById('signUpBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Creating account...';
    }

    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      if (data.user && !data.session) {
        // Email confirmation required
        this.showToast('Check your email to confirm your account!', 'success');
        this.isSignUp = false;
        this.updateUI();
      } else {
        this.showToast('Account created! Welcome!', 'success');
      }
    } catch (error) {
      console.error('Sign up error:', error);
      this.showToast(error.message || 'Sign up failed', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Account';
      }
    }
  }

  async handleLogout() {
    if (!this.supabase) return;

    try {
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.user = null;
      this.session = null;
      this.showToast('Logged out successfully', 'success');
      this.updateUI();
    } catch (error) {
      console.error('Logout error:', error);
      this.showToast('Logout failed', 'error');
    }
  }

  updateUI() {
    const authCard = document.getElementById('authCard');
    if (!authCard) return;

    const isConfigured = !!this.supabase;
    const isPremium = this.isPremium();

    // Update model selector state
    const modelSelectorRow = document.getElementById('standardModelRow');
    const modelSelector = document.getElementById('modelSelector');
    const modelLock = document.getElementById('modelLock');
    const premiumSettings = document.getElementById('premiumSettings');

    if (isPremium) {
      if (modelSelectorRow) modelSelectorRow.classList.add('hidden');
      if (premiumSettings) premiumSettings.classList.remove('hidden');
    } else {
      if (modelSelectorRow) modelSelectorRow.classList.remove('hidden');
      if (premiumSettings) premiumSettings.classList.add('hidden');
      if (modelSelector) {
        modelSelector.disabled = true;
        modelSelector.value = 'openai/gpt-4o-mini';
      }
      if (modelLock) modelLock.classList.remove('hidden');
    }

    // Update File Manager limits if it exists
    if (window.fileManager) {
      window.fileManager.updateLimitHint();
    }

    if (this.user) {
      // User is logged in - show welcome state
      const email = this.user.email;
      const planClass = isPremium ? 'premium' : 'free';
      const planText = isPremium ? '⭐ Premium' : 'Free Plan';
      const roundInfo = isPremium
        ? 'Unlimited debate rounds'
        : `Limited to ${MAX_FREE_ROUNDS} rounds per debate`;

      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">${isPremium ? '⭐' : '👋'}</span>
          <h2>Welcome!</h2>
          <p>${email}</p>
        </div>
        <div class="auth-form">
          <div class="user-status">
            <div class="status-badge ${planClass}">${planText}</div>
            <p class="plan-info">${roundInfo}</p>
          </div>
          <button id="myDebatesBtn" class="btn-primary">
            📚 My Debates
          </button>
          ${!isPremium ? `
            <button id="upgradeBtn" class="btn-secondary">
              Upgrade to Premium
            </button>
          ` : ''}
          <button id="logoutBtn" class="btn-secondary">
            Sign Out
          </button>
        </div>
      `;

      // My Debates button handler
      const myDebatesBtn = document.getElementById('myDebatesBtn');
      if (myDebatesBtn) {
        myDebatesBtn.addEventListener('click', () => {
          this.showMyDebates();
        });
      }

      // Upgrade button handler
      const upgradeBtn = document.getElementById('upgradeBtn');
      if (upgradeBtn) {
        upgradeBtn.addEventListener('click', () => {
          this.handleUpgrade();
        });
      }
    } else if (this.isSignUp) {
      // Show sign up form
      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">✦</span>
          <h2>Create Account</h2>
          <p>Join to save debates & more</p>
        </div>
        <div class="auth-form">
          <div class="auth-input-group">
            <label for="authEmail">Email</label>
            <input 
              type="email" 
              id="authEmail" 
              placeholder="you@example.com"
              autocomplete="email"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <div class="auth-input-group">
            <label for="authPassword">Password</label>
            <input 
              type="password" 
              id="authPassword" 
              placeholder="At least 6 characters"
              autocomplete="new-password"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <button id="signUpBtn" class="btn-primary" ${!isConfigured ? 'disabled' : ''}>
            Create Account
          </button>
          <p class="auth-switch">
            Already have an account? <a href="#" id="showSignIn">Sign in</a>
          </p>
          ${!isConfigured ? '<p class="auth-hint">Configure Supabase to enable auth</p>' : ''}
        </div>
      `;
    } else {
      // Show sign in form
      authCard.innerHTML = `
        <div class="auth-card-header">
          <span class="emblem">✦</span>
          <h2>Sign In</h2>
          <p>Save debates & unlock premium features</p>
        </div>
        <div class="auth-form">
          <div class="auth-input-group">
            <label for="authEmail">Email</label>
            <input 
              type="email" 
              id="authEmail" 
              placeholder="you@example.com"
              autocomplete="email"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <div class="auth-input-group">
            <label for="authPassword">Password</label>
            <input 
              type="password" 
              id="authPassword" 
              placeholder="••••••••"
              autocomplete="current-password"
              ${!isConfigured ? 'disabled' : ''}
            />
          </div>
          <button id="signInBtn" class="btn-primary" ${!isConfigured ? 'disabled' : ''}>
            Sign In
          </button>
          <p class="auth-switch">
            Don't have an account? <a href="#" id="showSignUp">Create one</a>
          </p>
          ${!isConfigured ? '<p class="auth-hint">Configure Supabase to enable auth</p>' : ''}
        </div>
      `;
    }
  }

  async handleUpgrade() {
    if (!this.user) {
      this.showToast('Please sign in to upgrade', 'error');
      return;
    }

    const upgradeBtn = document.getElementById('upgradeBtn');
    if (upgradeBtn) {
      upgradeBtn.textContent = 'Redirecting to Stripe...';
      upgradeBtn.disabled = true;
    }

    try {
      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: this.user.id,
          email: this.user.email
        })
      });

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Upgrade error:', error);
      this.showToast('Failed to start checkout', 'error');
      if (upgradeBtn) {
        upgradeBtn.textContent = 'Upgrade to Premium';
        upgradeBtn.disabled = false;
      }
    }
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('active');
    });

    setTimeout(() => {
      toast.classList.remove('active');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  isAuthenticated() {
    return !!this.user;
  }

  getUser() {
    return this.user;
  }

  async showMyDebates() {
    if (!this.supabase || !this.user) return;

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'debates-modal-backdrop';
    modal.innerHTML = `
      <div class="debates-modal">
        <div class="debates-modal-header">
          <h2>📚 My Debates</h2>
          <button class="modal-close-btn" id="closeDebatesModal">×</button>
        </div>
        <div class="debates-list" id="debatesList">
          <div class="debates-loading">Loading debates...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // Animate in
    requestAnimationFrame(() => {
      modal.classList.add('visible');
    });

    // Close handlers
    const closeBtn = document.getElementById('closeDebatesModal');
    closeBtn.addEventListener('click', () => this.closeDebatesModal(modal));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) this.closeDebatesModal(modal);
    });

    // Fetch debates
    try {
      const { data: debates, error } = await this.supabase
        .from('debates')
        .select('*')
        .eq('user_id', this.user.id)
        .order('created_at', { ascending: false });

      const debatesList = document.getElementById('debatesList');

      if (error) {
        debatesList.innerHTML = `<div class="debates-error">Failed to load debates</div>`;
        return;
      }

      if (!debates || debates.length === 0) {
        debatesList.innerHTML = `
          <div class="debates-empty">
            <span class="empty-icon">💭</span>
            <p>No debates yet!</p>
            <p class="empty-hint">Start a debate and it will appear here.</p>
          </div>
        `;
        return;
      }

      debatesList.innerHTML = debates.map(debate => {
        const date = new Date(debate.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        const winnerBadge = debate.winner
          ? `<span class="winner-badge ${debate.winner}">${debate.winner === 'advocate' ? '✓ Advocate' : debate.winner === 'skeptic' ? '✗ Skeptic' : '⚖ Draw'}</span>`
          : '<span class="winner-badge pending">In Progress</span>';

        return `
          <div class="debate-item" data-debate-id="${debate.id}">
            <div class="debate-item-header">
              <span class="debate-date">${date}</span>
              ${winnerBadge}
            </div>
            <p class="debate-idea">${this.escapeHtml(debate.idea)}</p>
            <div class="debate-item-footer">
              <span class="debate-rounds">${debate.rounds || 0} rounds</span>
              <div class="debate-actions">
                <button class="btn-delete-debate" data-id="${debate.id}" title="Delete debate">🗑</button>
                <button class="btn-view-debate" data-id="${debate.id}">View →</button>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Add click handlers to view buttons
      debatesList.querySelectorAll('.btn-view-debate').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const debateId = e.target.dataset.id;
          const debate = debates.find(d => d.id === debateId);
          if (debate) {
            this.closeDebatesModal(modal);
            window.debateArena.loadPastDebate(debate);
          }
        });
      });

      // Add click handlers to delete buttons
      debatesList.querySelectorAll('.btn-delete-debate').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const debateId = e.target.dataset.id;

          if (!confirm('Are you sure you want to delete this debate?')) {
            return;
          }

          try {
            const { error } = await this.supabase
              .from('debates')
              .delete()
              .eq('id', debateId);

            if (error) {
              this.showToast('Failed to delete debate', 'error');
              return;
            }

            // Remove from UI
            const item = debatesList.querySelector(`[data-debate-id="${debateId}"]`);
            if (item) {
              item.style.opacity = '0';
              item.style.transform = 'translateX(-20px)';
              setTimeout(() => item.remove(), 200);
            }

            this.showToast('Debate deleted', 'success');

            // Check if list is now empty
            setTimeout(() => {
              if (debatesList.querySelectorAll('.debate-item').length === 0) {
                debatesList.innerHTML = `
                  <div class="debates-empty">
                    <span class="empty-icon">💭</span>
                    <p>No debates yet!</p>
                    <p class="empty-hint">Start a debate and it will appear here.</p>
                  </div>
                `;
              }
            }, 250);

          } catch (error) {
            console.error('Failed to delete debate:', error);
            this.showToast('Failed to delete debate', 'error');
          }
        });
      });

    } catch (error) {
      console.error('Failed to fetch debates:', error);
      document.getElementById('debatesList').innerHTML = `
        <div class="debates-error">Failed to load debates</div>
      `;
    }
  }

  closeDebatesModal(modal) {
    modal.classList.remove('visible');
    setTimeout(() => modal.remove(), 300);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// ============================================
// DEBATE ARENA
// ============================================

class DebateArena {
  constructor() {
    this.debateId = null;
    this.currentRound = 0;
    this.isDebating = false;
    this.isPaused = false;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';

    // Store all arguments for the judge
    this.advocateArguments = [];
    this.skepticArguments = [];

    // Store clarifications from user
    this.clarifications = [];

    // Pending clarification state
    this.pendingClarification = null;

    // Pre-debate clarification state
    this.isPreDebateClarification = false;
    this.preDebateClarifications = [];
    this.pendingPreDebateQuestions = [];
    this.preDebateIdea = null;
    this.preDebateFiles = null;

    // Track if a round was interrupted mid-way
    this.interruptedTurn = null; // null, 'advocate-pending', or 'skeptic-pending'
    this.discoveryDone = false;

    this.init();
  }

  init() {
    // DOM Elements
    this.ideaSection = document.getElementById('ideaSection');
    this.debateLayout = document.getElementById('debateLayout');
    this.ideaInput = document.getElementById('ideaInput');
    this.startDebateBtn = document.getElementById('startDebate');

    this.debateChat = document.getElementById('debateChat');
    this.currentIdeaEl = document.getElementById('currentIdea');
    this.roundNumberEl = document.getElementById('roundNumber');
    this.pauseDebateBtn = document.getElementById('pauseDebate');
    this.judgeDebateBtn = document.getElementById('judgeDebate');
    this.newDebateBtn = document.getElementById('newDebate');

    this.verdictPanel = document.getElementById('verdictPanel');
    this.verdictContent = document.getElementById('verdictContent');
    this.closeVerdictBtn = document.getElementById('closeVerdict');

    this.thinkingEmpty = document.getElementById('thinkingEmpty');
    this.thinkingActive = document.getElementById('thinkingActive');
    this.thinkingWho = document.getElementById('thinkingWho');
    this.thinkingContent = document.getElementById('thinkingContent');

    this.clarificationModal = document.getElementById('clarificationModal');
    this.clarificationQuestionsContainer = document.getElementById('clarificationQuestionsContainer');
    this.clarificationClaim = document.getElementById('clarificationClaim');
    this.clarificationQuestion = document.getElementById('clarificationQuestion');
    this.clarificationAnswer = document.getElementById('clarificationAnswer');
    this.skipClarificationBtn = document.getElementById('skipClarification');
    this.submitClarificationBtn = document.getElementById('submitClarification');


    // Allow Enter to start debate
    this.ideaInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.startDebate();
      }
    });

    this.startDebateBtn?.addEventListener('click', () => this.startDebate());
    this.pauseDebateBtn?.addEventListener('click', () => this.togglePause());
    this.judgeDebateBtn?.addEventListener('click', () => this.callJudge());
    this.newDebateBtn?.addEventListener('click', () => this.resetDebate());
    this.closeVerdictBtn?.addEventListener('click', () => this.closeVerdict());
    this.skipClarificationBtn?.addEventListener('click', () => this.skipClarification());
    this.submitClarificationBtn?.addEventListener('click', () => this.submitClarification());
  }

  async checkHealth() {
    try {
      const response = await fetch('/api/health');
      const data = await response.json();

    } catch (error) {
      console.error('Health check failed:', error);
    }
  }



  async startDebate() {
    const idea = this.ideaInput?.value?.trim?.() || '';
    if (!idea) {
      this.ideaInput?.focus?.();
      return;
    }

    // Get attached files
    const files = window.fileManager ? window.fileManager.getFilesForDebate() : [];
    this.attachedFiles = files;

    // Disable start button while analyzing
    if (this.startDebateBtn) {
      this.startDebateBtn.disabled = true;
      this.startDebateBtn.textContent = 'Analyzing...';
    }

    try {
      // First, analyze the idea and ask clarifying questions BEFORE making assumptions
      const analysisResponse = await fetch('/api/analyze-idea', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idea, files })
      });

      if (analysisResponse.ok) {
        const analysis = await analysisResponse.json();

        // If there are clarifying questions, ask them first
        if (analysis.questions && analysis.questions.length > 0) {
          if (this.startDebateBtn) {
            this.startDebateBtn.disabled = false;
            this.startDebateBtn.textContent = 'Start';
          }

          // Store pending questions and continue after all are answered
          await this.askPreDebateClarifications(idea, files, analysis.questions);
          return; // continuation happens in showNextPreDebateQuestion()
        }
      }

      // No questions needed, proceed directly
      await this.proceedWithDebate(idea, files);
    } catch (error) {
      console.error('Failed to start debate:', error);
      this.showError('Failed to start debate. Please try again.');
      if (this.startDebateBtn) {
        this.startDebateBtn.disabled = false;
        this.startDebateBtn.textContent = 'Start';
      }
    }
  }

  async askPreDebateClarifications(idea, files, questions) {
    this.preDebateIdea = idea;
    this.preDebateFiles = files;
    this.isPreDebateClarification = true;

    // Show all questions at once
    this.showClarificationModal(questions);
  }

  // showNextPreDebateQuestion removed in favor of batch mode

  async proceedWithDebate(idea, files) {


    this.startDebateBtn.disabled = true;
    this.startDebateBtn.textContent = 'Starting...';

    try {
      const response = await fetch('/api/start-debate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idea, files })
      });

      const data = await response.json();
      this.debateId = data.debateId;
      this.currentRound = 1;
      this.isPaused = false;
      this.currentIdea = idea;
      this.interruptedTurn = null;
      this.discoveryDone = false; // Reset discovery state

      // Reset argument storage
      this.advocateArguments = [];
      this.skepticArguments = [];

      // Add pre-debate clarifications to the main clarifications array
      if (this.preDebateClarifications && this.preDebateClarifications.length > 0) {
        this.clarifications = [...this.preDebateClarifications];
      }

      // Clear file manager after starting debate
      if (window.fileManager) {
        window.fileManager.clear();
      }

      // Create debate record in Supabase (for logged-in users)
      await this.createSupabaseDebate(idea);

      // Update UI
      this.currentIdeaEl.textContent = idea;
      this.ideaSection.classList.add('hidden');
      this.debateLayout.classList.remove('hidden');
      this.roundNumberEl.textContent = this.currentRound;
      this.pauseDebateBtn.classList.remove('paused');
      this.pauseDebateBtn.textContent = '⏸';
      this.judgeDebateBtn.disabled = true;

      // Clear previous messages and verdict
      this.debateChat.innerHTML = '';
      this.verdictPanel.classList.add('hidden');
      this.resetThinkingSidebar();

      // Reset button state
      this.startDebateBtn.disabled = false;
      this.startDebateBtn.textContent = 'Start';

      // Start the continuous debate loop
      this.runDebateLoop();

    } catch (error) {
      console.error('Failed to start debate:', error);
      this.showError('Failed to start debate. Please try again.');
      this.startDebateBtn.disabled = false;
      this.startDebateBtn.textContent = 'Start';
    }
  }

  async runDebateLoop() {
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 2;

    while (!this.isPaused && this.debateId) {
      // Check round limit for free/unauthenticated users
      const hasAccess = this.canAccessUnlimitedRounds();
      if (this.currentRound > MAX_FREE_ROUNDS && !hasAccess) {
        this.isPaused = true;
        this.showRoundLimitReached();
        break;
      }

      // Update UI round label
      if (this.currentRound === 1) {
        this.roundNumberEl.textContent = 'Discovery Phase';
      } else {
        this.roundNumberEl.textContent = this.currentRound;
      }

      const success = await this.runDebateRound();

      // If the round was interrupted for clarification, DON'T increment yet
      if (this.isPaused) {
        console.log('Debate loop paused for clarification');
        break;
      }

      if (!success) {
        consecutiveErrors++;
        console.warn(`Round failed (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`);

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          this.isPaused = true;
          this.showError('Debate paused due to repeated errors. Please check your connection or credits.');
          this.showRestartOption();
          break;
        }

        await this.delay(2000);
        continue;
      }

      // Reset error count on success
      consecutiveErrors = 0;

      // Enable judge button after first round
      if (this.advocateArguments.length > 0 && this.skepticArguments.length > 0) {
        this.judgeDebateBtn.disabled = false;
      }

      // Save debate progress
      await this.updateSupabaseDebate();

      if (this.isPaused) break;

      // Increment round ONLY after both sides finished arguments.
      // If we just finished Discovery preamble, stay in Round 1.
      if (this.discoveryDone && this.interruptedTurn === null) {
        this.currentRound++;
      }

      // Check if next round would exceed limit
      if (this.currentRound > MAX_FREE_ROUNDS && !this.canAccessUnlimitedRounds()) {
        this.isPaused = true;
        this.showRoundLimitReached();
        break;
      }

      // Pause between rounds
      await this.delay(2500);
    }
  }

  showRestartOption() {
    const restartMsg = document.createElement('div');
    restartMsg.className = 'message system-error';
    restartMsg.innerHTML = `
      <div class="message-content" style="color: #c4553a; border: 1px solid #c4553a; background: #fff5f5;">
        <strong>⚠️ Debate Stopped</strong>
        <p>Too many errors occurred. You can try resuming or start over.</p>
        <button class="btn-secondary" onclick="window.debateArena.togglePause()">Resume Debate</button>
      </div>
    `;
    this.debateChat.appendChild(restartMsg);
    this.scrollToBottom(this.debateChat);
  }

  canAccessUnlimitedRounds() {
    // Check if user is authenticated and has premium
    const auth = window.authManager;
    if (!auth || !auth.user) {
      console.log('DebateLimit: No user logged in');
      return false;
    }

    // Explicit debug log
    const isPremium = auth.profile && auth.profile.is_premium === true;
    console.log(`DebateLimit: User=${auth.user.email}, Premium=${isPremium}`);
    return isPremium;
  }

  // ==========================================
  // SUPABASE DEBATE TRACKING
  // ==========================================

  async createSupabaseDebate(idea) {
    const auth = window.authManager;
    if (!auth || !auth.user || !auth.supabase) {
      this.supabaseDebateId = null;
      return;
    }

    try {
      const { data, error } = await auth.supabase
        .from('debates')
        .insert({
          user_id: auth.user.id,
          idea: idea,
          rounds: 0,
          advocate_arguments: [],
          skeptic_arguments: []
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to create debate record:', error);
        this.supabaseDebateId = null;
      } else {
        this.supabaseDebateId = data.id;
        console.log('Debate record created:', this.supabaseDebateId);
      }
    } catch (error) {
      console.error('Failed to create debate record:', error);
      this.supabaseDebateId = null;
    }
  }

  async updateSupabaseDebate() {
    const auth = window.authManager;
    if (!auth || !auth.supabase || !this.supabaseDebateId) return;

    try {
      const { error } = await auth.supabase
        .from('debates')
        .update({
          rounds: this.currentRound,
          advocate_arguments: this.advocateArguments,
          skeptic_arguments: this.skepticArguments
        })
        .eq('id', this.supabaseDebateId);

      if (error) {
        console.error('Failed to update debate:', error);
      }
    } catch (error) {
      console.error('Failed to update debate:', error);
    }
  }

  async saveDebateVerdict(verdict, winner) {
    const auth = window.authManager;
    if (!auth || !auth.supabase || !this.supabaseDebateId) return;

    try {
      const { error } = await auth.supabase
        .from('debates')
        .update({
          verdict: verdict,
          winner: winner,
          rounds: this.currentRound,
          advocate_arguments: this.advocateArguments,
          skeptic_arguments: this.skepticArguments
        })
        .eq('id', this.supabaseDebateId);

      if (error) {
        console.error('Failed to save verdict:', error);
      } else {
        console.log('Debate verdict saved');
      }
    } catch (error) {
      console.error('Failed to save verdict:', error);
    }
  }

  showRoundLimitReached() {
    // Update pause button to show paused state
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';

    const auth = window.authManager;
    const isSignedIn = auth && auth.user;
    const isPremium = auth && auth.isPremium();

    // Show limit message
    const limitMessage = document.createElement('div');
    limitMessage.className = 'round-limit-message';

    if (!isSignedIn) {
      // Not signed in
      limitMessage.innerHTML = `
        <div class="limit-content">
          <span class="limit-icon">🔒</span>
          <h3>Round Limit Reached</h3>
          <p>Free users are limited to ${MAX_FREE_ROUNDS} rounds per debate.</p>
          <p>Sign in or upgrade to Premium for unlimited rounds!</p>
          <button class="btn-limit-action" onclick="document.getElementById('authCard').scrollIntoView({behavior: 'smooth'})">
            Sign In to Continue
          </button>
        </div>
      `;
    } else if (!isPremium) {
      // Signed in but free plan
      limitMessage.innerHTML = `
        <div class="limit-content">
          <span class="limit-icon">🔒</span>
          <h3>Round Limit Reached</h3>
          <p>Free plan is limited to ${MAX_FREE_ROUNDS} rounds per debate.</p>
          <p>Upgrade to Premium for unlimited debate rounds!</p>
          <button class="btn-limit-action" onclick="window.authManager.handleUpgrade()">
            Upgrade to Premium
          </button>
        </div>
      `;
    }

    this.debateChat.appendChild(limitMessage);
    limitMessage.scrollIntoView({ behavior: 'smooth' });
  }

  async runDebateRound() {
    if (this.isDebating) return false;
    this.isDebating = true;
    let success = true;

    try {
      if (this.isPaused) return true;

      // Phase 1: Discovery (Round 1 preamble)
      if (this.currentRound === 1 && !this.discoveryDone) {
        console.log("Starting Discovery Phase...");
        success = await this.startDiscovery();
        // After discovery modal shows, we return true to runDebateLoop 
        // which now knows NOT to increment currentRound.
        return success;
      }

      // Phase 2: Arguments (starts after Discovery in Round 1)

      // Resumption logic for interrupted turns (Fact-checking or LLM clarification)
      if (this.pendingTurnRetry) {
        const { role, previousArgument, messageEl } = this.pendingTurnRetry;
        this.pendingTurnRetry = null;
        return await this.getDebaterResponse(role, previousArgument, messageEl);
      }

      // Try Advocate (unless resume logic says skip to Skeptic)
      if (this.interruptedTurn !== 'skeptic-pending') {
        const advocateResult = await this.getDebaterResponse('advocate', this.lastSkepticArgument);
        if (!advocateResult) {
          success = false;
          return false;
        }

        // If advocate triggered a pause, stop here and wait for resumption
        if (this.isPaused) {
          return true;
        }
      }

      this.interruptedTurn = 'skeptic-pending';
      await this.delay(2000);
      if (this.isPaused) return true;

      // Try Skeptic
      const skepticResult = await this.getDebaterResponse('skeptic', this.lastAdvocateArgument);
      if (!skepticResult) {
        success = false;
        return false;
      }

      if (this.isPaused) return true;

      // Both sides finished successfully
      this.interruptedTurn = null;

    } catch (error) {
      console.error('Debate round failed:', error);
      success = false;
    } finally {
      this.isDebating = false;
    }

    return success;
  }

  async startDiscovery() {
    try {
      this.isPaused = true; // Pause loop

      // Update UI round label
      this.roundNumberEl.textContent = 'Discovery Phase';

      const response = await fetch('/api/discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: this.preDebateIdea || document.getElementById('ideaInput')?.value?.trim(),
          files: this.attachedFiles || []
        })
      });

      if (!response.ok) throw new Error('Discovery failed');

      const data = await response.json();

      // Map to questions modal
      if (data.clarifications && data.clarifications.length > 0) {
        this.showClarificationModal(data.clarifications);
        return true;
      } else {
        // No questions? Skip to argument phase
        this.isPaused = false;
        return true;
      }
    } catch (error) {
      console.error('Discovery round error:', error);
      this.isPaused = false;
      return false;
    }
  }

  async getDebaterResponse(role, previousArgument) {
    const isAdvocate = role === 'advocate';
    const name = isAdvocate ? 'Advocate' : 'Skeptic';
    const icon = isAdvocate ? '✓' : '✗';

    // Show typing indicator in chat
    const typingEl = this.createTypingIndicator(role, name);
    this.debateChat.appendChild(typingEl);
    this.scrollToBottom(this.debateChat);

    // Show thinking in sidebar
    this.showThinking(role, name);

    // Create message element
    const messageEl = document.createElement('div');
    messageEl.className = `message ${role}`;
    messageEl.innerHTML = `
      <div class="message-header">
        <div class="message-icon">${icon}</div>
        <span class="message-name">${name}</span>
        <span class="message-round">Round ${this.currentRound}</span>
      </div>
      <div class="message-content"></div>
    `;

    try {
      const isPremium = window.authManager?.isPremium();
      const model = isPremium ? this.getSelectedModel(role) : this.getSelectedModel();
      const instructions = isPremium ? this.getGuidingInstructions(role) : '';

      const response = await fetch('/api/debate-turn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          debateId: this.debateId,
          role,
          previousArgument,
          clarifications: this.clarifications,
          model: model,
          instructions: instructions
        })
      });

      // Special handling for JSON responses (clarifications/errors)
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        const data = await response.json();

        if (data.needsClarification) {
          typingEl.remove();
          this.resetThinkingSidebar();
          // Store for resumption
          this.pendingTurnRetry = { role, previousArgument };
          await this.askClarification(data.question, role, previousArgument);
          return true; // Use true because it's a valid pause, not a technical failure
        }

        if (data.error) {
          console.error(`Server error in ${role} turn:`, data.error);
          throw new Error(data.error);
        }
      }

      typingEl.remove();
      this.debateChat.appendChild(messageEl);

      const messageContent = messageEl.querySelector('.message-content');
      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;

                const parsed = this.parseResponse(fullText);

                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }

                // Update message content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  messageContent.innerHTML = this.formatText(outputText);
                  this.scrollToBottom(this.debateChat);
                }
              }

              if (data.done) {
                // Check if we got an actual response
                if (!outputText || outputText.trim().length < 10) {
                  console.warn(`${role} returned empty or very short response`);
                  console.warn(`Full text received (${fullText.length} chars):`, fullText.substring(0, 500));
                  console.warn(`Parsed thinking (${thinkingText.length} chars):`, thinkingText.substring(0, 200));
                  console.warn(`Parsed output (${outputText.length} chars):`, outputText);

                  // Try to show whatever we got
                  if (fullText.length > 20) {
                    // Use raw text as fallback
                    const cleanText = fullText.replace(/<\/?thinking>/g, '').replace(/<\/?output>/g, '').trim();
                    messageContent.innerHTML = this.formatText(cleanText);
                    outputText = cleanText;
                  } else {
                    messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} had nothing to say... (API returned empty response)</p>`;
                  }
                } else {
                  // No specific storage here - wait for fact-check
                }

                // Clear thinking after a moment
                setTimeout(() => {
                  if (!this.isDebating) {
                    this.resetThinkingSidebar();
                  }
                }, 500);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      }

      // Final check - if no output was captured at all
      if (!outputText || outputText.trim().length < 10) {
        console.error(`[${role}] No significant output captured. FullText length: ${fullText.length}`);
        messageContent.innerHTML = `<p style="color: #c4553a; font-style: italic;">${name} didn't respond. Retrying might help.</p>`;
        return false; // Indicate failure
      }

      // ---------------------------------------------------------
      // IN-DEBATE FACT CHECKING (Retry Mode)
      // ---------------------------------------------------------
      const clarifications = await this.checkForClarification(outputText, role);
      if (clarifications && clarifications.length > 0) {
        // Pause the debate
        this.isPaused = true;
        if (this.pauseDebateBtn) {
          this.pauseDebateBtn.textContent = '▶';
          this.pauseDebateBtn.title = 'Resume';
        }

        // Show all questions at once
        this.pendingTurnRetry = { role, previousArgument, messageEl };
        this.showClarificationModal(clarifications.slice(0, 3), role);

        return true;
      }

      // NO CLARIFICATIONS NEEDED - Store the argument permanently
      if (role === 'advocate') {
        this.lastAdvocateArgument = outputText;
        this.advocateArguments.push(outputText);
      } else {
        this.lastSkepticArgument = outputText;
        this.skepticArguments.push(outputText);
      }

      return true; // Indicate success

    } catch (error) {
      typingEl.remove();
      console.error(`${role} response failed:`, error);
      this.resetThinkingSidebar();

      // Show error in chat but don't crash the debate
      const errorEl = document.createElement('div');
      errorEl.className = `message ${role}`;
      errorEl.innerHTML = `
          <div class="message-header">
            <div class="message-icon" style="background: #c4553a;">!</div>
            <span class="message-name">${name}</span>
            <span class="message-round">Error</span>
          </div>
          <div class="message-content" style="color: #c4553a;">
            <p>Failed to get response: ${error.message}</p>
          </div>
        `;
      this.debateChat.appendChild(errorEl);

      return false; // Indicate failure so the loop can handle it
    }
  }

  async callJudge() {
    if (this.advocateArguments.length === 0 || this.skepticArguments.length === 0) {
      this.showError('Need at least one round of debate before calling the judge.');
      return;
    }

    // Pause the debate
    this.isPaused = true;
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';
    this.judgeDebateBtn.disabled = true;

    // Show verdict panel with loading state
    this.verdictPanel.classList.remove('hidden');
    this.verdictContent.innerHTML = '<p style="color: #8b7328; font-style: italic;">⚖️ The judge is deliberating...</p>';

    // Show thinking in sidebar
    this.showThinking('judge', 'Judge');

    try {
      const response = await fetch('/api/judge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          debateId: this.debateId,
          advocateArguments: this.advocateArguments,
          skepticArguments: this.skepticArguments,
          idea: this.currentIdea // Fallback for loaded past debates
        })
      });

      let fullText = '';
      let thinkingText = '';
      let outputText = '';

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.error) {
                throw new Error(data.error);
              }

              if (data.content) {
                fullText += data.content;

                const parsed = this.parseResponse(fullText);

                // Update thinking sidebar
                if (parsed.thinking !== thinkingText) {
                  thinkingText = parsed.thinking;
                  this.thinkingContent.innerHTML = this.formatText(thinkingText);
                }

                // Update verdict content
                if (parsed.output !== outputText) {
                  outputText = parsed.output;
                  this.verdictContent.innerHTML = this.formatVerdict(outputText);
                }
              }

              if (data.done) {
                this.resetThinkingSidebar();

                // Extract winner from verdict and save
                const winner = this.extractWinner(outputText);
                await this.saveDebateVerdict(outputText, winner);
              }
            } catch (e) {
              // Skip invalid JSON
            }
          }
        }
      }

    } catch (error) {
      console.error('Judge failed:', error);
      this.verdictContent.innerHTML = `<p style="color: #c4553a;">Failed to get verdict: ${error.message}</p>`;
      this.resetThinkingSidebar();
    }

    this.judgeDebateBtn.disabled = false;
  }

  extractWinner(verdictText) {
    // Try to extract the winner from the verdict text
    const text = verdictText.toLowerCase();
    if (text.includes('advocate wins') || text.includes('winner: advocate') || text.includes('advocate is the winner')) {
      return 'advocate';
    } else if (text.includes('skeptic wins') || text.includes('winner: skeptic') || text.includes('skeptic is the winner')) {
      return 'skeptic';
    } else if (text.includes('draw') || text.includes('tie')) {
      return 'draw';
    }
    return null;
  }

  formatVerdict(text) {
    if (!text) return '';

    // Convert markdown-style formatting
    let html = text
      // Headers
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Winner highlighting
      .replace(/Winner: (Advocate)/gi, 'Winner: <span class="verdict-winner advocate">$1</span>')
      .replace(/Winner: (Skeptic)/gi, 'Winner: <span class="verdict-winner skeptic">$1</span>')
      // Line breaks to paragraphs
      .split('\n\n')
      .filter(p => p.trim())
      .map(p => {
        if (p.startsWith('<h2>') || p.startsWith('<h3>')) return p;
        if (p.startsWith('- ') || p.startsWith('* ')) {
          const items = p.split('\n').map(li => `<li>${li.replace(/^[-*] /, '')}</li>`).join('');
          return `<ul>${items}</ul>`;
        }
        return `<p>${p.replace(/\n/g, '<br>')}</p>`;
      })
      .join('');

    return html;
  }

  closeVerdict() {
    this.verdictPanel.classList.add('hidden');
  }

  showThinking(role, name) {
    this.thinkingEmpty.classList.add('hidden');
    this.thinkingActive.classList.remove('hidden');
    this.thinkingWho.textContent = `${name} is reasoning...`;
    this.thinkingWho.className = `thinking-who ${role}`;
    this.thinkingContent.innerHTML = '';
  }

  resetThinkingSidebar() {
    this.thinkingEmpty.classList.remove('hidden');
    this.thinkingActive.classList.add('hidden');
    this.thinkingContent.innerHTML = '';
  }

  parseResponse(text) {
    if (!text) return { thinking: '', output: '' };

    let thinking = '';
    let output = '';

    // 1. Try to extract <thinking> tags
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
    } else {
      // If no closing tag, everything after <thinking> is thinking
      const thinkingStart = text.indexOf('<thinking>');
      if (thinkingStart !== -1) {
        thinking = text.substring(thinkingStart + 10).trim();
      }
    }

    // 2. Try to extract <output> tags
    const outputMatch = text.match(/<output>([\s\S]*?)<\/output>/);
    if (outputMatch) {
      output = outputMatch[1].trim();
    } else {
      // If no closing tag, everything after <output> is output
      const outputStart = text.indexOf('<output>');
      if (outputStart !== -1) {
        output = text.substring(outputStart + 8).trim();
      }
    }

    // 3. FALLBACK: If no <output> found, look for text after thinking
    if (!output) {
      if (text.includes('</thinking>')) {
        output = text.split('</thinking>')[1].trim();
      } else if (!text.includes('<thinking>') && !text.includes('<output>')) {
        // If no tags at all, the whole thing is output
        output = text.trim();
      }
    }

    // Clean up any remaining tags from output
    if (output) {
      output = output.replace(/<\/?output>/g, '').replace(/<\/?thinking>/g, '').trim();
    }

    if (!output && thinking) {
      console.warn('Got thinking but no output. Full text length:', text.length);
    }

    return { thinking, output };
  }

  formatText(text) {
    if (!text) return '';

    const paragraphs = text.split('\n\n').filter(p => p.trim());
    if (paragraphs.length > 1) {
      return paragraphs.map(p => `<p>${this.escapeHtml(p.trim())}</p>`).join('');
    }

    return `<p>${this.escapeHtml(text)}</p>`;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  createTypingIndicator(role, name) {
    const el = document.createElement('div');
    el.className = `typing-indicator ${role}`;
    el.innerHTML = `
      <div class="typing-dots">
        <span></span><span></span><span></span>
      </div>
      <span class="typing-label">${name} is preparing...</span>
    `;
    return el;
  }

  togglePause() {
    this.isPaused = !this.isPaused;
    this.pauseDebateBtn.classList.toggle('paused', this.isPaused);

    if (this.isPaused) {
      this.pauseDebateBtn.textContent = '▶';
      this.pauseDebateBtn.title = 'Resume';
    } else {
      this.pauseDebateBtn.textContent = '⏸';
      this.pauseDebateBtn.title = 'Pause';

      // Close verdict if open
      this.verdictPanel.classList.add('hidden');

      if (!this.isDebating) {
        this.runDebateLoop();
      }
    }
  }

  resetDebate() {
    this.isPaused = true;
    this.debateId = null;
    this.currentRound = 0;
    this.lastAdvocateArgument = '';
    this.lastSkepticArgument = '';
    this.advocateArguments = [];
    this.skepticArguments = [];
    this.ideaInput.value = '';

    this.resetThinkingSidebar();
    this.verdictPanel.classList.add('hidden');
    this.debateLayout.classList.add('hidden');
    this.ideaSection.classList.remove('hidden');
    this.ideaInput.focus();
  }

  async loadPastDebate(debate) {
    // Load a saved debate from Supabase
    this.isPaused = true;
    this.supabaseDebateId = debate.id;
    this.currentIdea = debate.idea;
    this.advocateArguments = debate.advocate_arguments || [];
    this.skepticArguments = debate.skeptic_arguments || [];
    this.currentRound = debate.rounds || Math.max(this.advocateArguments.length, this.skepticArguments.length);

    // Set last arguments for continuing the debate
    this.lastAdvocateArgument = this.advocateArguments[this.advocateArguments.length - 1] || '';
    this.lastSkepticArgument = this.skepticArguments[this.skepticArguments.length - 1] || '';

    // Create a server-side debate instance for API calls
    try {
      const response = await fetch('/api/start-debate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ idea: debate.idea })
      });
      const data = await response.json();
      this.debateId = data.debateId;
    } catch (error) {
      console.error('Failed to create server debate instance:', error);
    }

    // Switch to debate view
    this.ideaSection.classList.add('hidden');
    this.debateLayout.classList.remove('hidden');
    this.currentIdeaEl.textContent = debate.idea;
    this.roundNumberEl.textContent = this.currentRound;
    this.pauseDebateBtn.classList.add('paused');
    this.pauseDebateBtn.textContent = '▶';
    this.judgeDebateBtn.disabled = this.advocateArguments.length === 0;

    // Clear and rebuild chat from saved arguments
    this.debateChat.innerHTML = '';

    const maxRounds = Math.max(this.advocateArguments.length, this.skepticArguments.length);
    for (let i = 0; i < maxRounds; i++) {
      // Advocate message
      if (this.advocateArguments[i]) {
        this.addHistoricalMessage('advocate', this.advocateArguments[i], i + 1);
      }
      // Skeptic message
      if (this.skepticArguments[i]) {
        this.addHistoricalMessage('skeptic', this.skepticArguments[i], i + 1);
      }
    }

    // Show verdict if exists
    if (debate.verdict) {
      this.verdictPanel.classList.remove('hidden');
      this.verdictContent.innerHTML = this.formatVerdict(debate.verdict);
    } else {
      this.verdictPanel.classList.add('hidden');
    }

    this.resetThinkingSidebar();

    // Scroll to bottom of chat to show latest
    this.debateChat.scrollTop = this.debateChat.scrollHeight;
  }

  addHistoricalMessage(role, content, round) {
    const messageElement = document.createElement('div');
    messageElement.className = `debate-message ${role}-message`;
    const icon = role === 'advocate' ? '✓' : '✗';
    const name = role === 'advocate' ? 'Advocate' : 'Skeptic';
    messageElement.innerHTML = `
      <div class="message-header">
        <div class="message-icon">${icon}</div>
        <span class="message-name">${name}</span>
        <span class="message-round">Round ${round}</span>
      </div>
      <div class="message-content">${this.formatText(content)}</div>
    `;
    this.debateChat.appendChild(messageElement);
  }

  showError(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 1.5rem;
      left: 50%;
      transform: translateX(-50%);
      background: #c4553a;
      color: white;
      padding: 0.875rem 1.5rem;
      border-radius: 8px;
      font-weight: 500;
      font-size: 0.875rem;
      z-index: 1000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 5000);
  }

  showMessageError(message) {
    const errorEl = document.createElement('div');
    errorEl.style.cssText = `
      background: #fdf0ed;
      border: 1px solid #c4553a;
      border-radius: 8px;
      padding: 1rem;
      color: #c4553a;
      font-size: 0.875rem;
      margin: 0.5rem 0;
    `;
    errorEl.textContent = message;
    this.debateChat.appendChild(errorEl);
  }

  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================
  // CLARIFICATION METHODS
  // ============================================

  async checkForClarification(draftResponse, role) {
    // Checking for clarification needed
    try {
      const response = await fetch('/api/check-facts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          debateId: this.debateId,
          draftResponse,
          idea: this.currentIdea,
          role: role
        })
      });

      if (!response.ok) {
        console.error('Fact check failed:', response.status);
        return null;
      }

      const result = await response.json();
      // Fact check result result

      // New format: { clarifications: [...] }
      if (result.clarifications && result.clarifications.length > 0) {
        return result.clarifications; // Return array
      }
      return null;
    } catch (error) {
      console.error('Fact check error:', error);
      return null;
    }
  }

  showClarificationModal(batch, roleSource = null) {
    // Clear the container
    this.clarificationQuestionsContainer.innerHTML = '';

    // If it's a single object (legacy), wrap it
    const questions = Array.isArray(batch) ? batch : [batch];

    questions.forEach((item, index) => {
      const qDiv = document.createElement('div');
      qDiv.className = 'clarification-batch-item';
      qDiv.style.marginBottom = '1.5rem';

      const claimEl = document.createElement('p');
      claimEl.className = 'clarification-claim';
      claimEl.style.fontSize = '0.8rem';
      claimEl.style.opacity = '0.7';

      // Role-aware labeling logic
      let label = 'Founder Question';
      if (roleSource) {
        const roleName = roleSource === 'advocate' ? 'Advocate' : 'Skeptic';
        label = `${roleName} wants to know`;
      } else if (item.claim) {
        label = item.claim;
      }

      claimEl.textContent = `"${label}"`;

      const questionEl = document.createElement('label');
      questionEl.className = 'clarification-label';
      questionEl.style.display = 'block';
      questionEl.style.marginBottom = '0.5rem';
      questionEl.style.fontWeight = '500';
      questionEl.textContent = item.question;

      const answerEl = document.createElement('textarea');
      answerEl.className = 'clarification-input batch-answer';
      answerEl.placeholder = 'Type your answer...';
      answerEl.rows = 2;
      answerEl.dataset.question = item.question;

      qDiv.appendChild(claimEl);
      qDiv.appendChild(questionEl);
      qDiv.appendChild(answerEl);
      this.clarificationQuestionsContainer.appendChild(qDiv);

      if (index === 0) setTimeout(() => answerEl.focus(), 100);
    });

    this.clarificationModal.classList.remove('hidden');

    // Pause the debate
    this.isPaused = true;
    if (this.pauseDebateBtn) {
      this.pauseDebateBtn.textContent = '▶';
      this.pauseDebateBtn.title = 'Resume';
    }
  }

  hideClarificationModal() {
    this.clarificationModal.classList.add('hidden');
  }

  getSelectedModel(role) {
    if (role && window.authManager?.isPremium()) {
      const selectorId = role === 'advocate' ? 'advocateModelSelector' : 'skepticModelSelector';
      const selector = document.getElementById(selectorId);
      if (selector) return selector.value;
    }

    const selector = document.getElementById('modelSelector');
    if (selector) {
      return selector.value;
    }
    return 'openai/gpt-4o-mini';
  }

  getGuidingInstructions(role) {
    if (!role || !window.authManager?.isPremium()) return '';
    const inputId = role === 'advocate' ? 'advocateInstructions' : 'skepticInstructions';
    const input = document.getElementById(inputId);
    return input ? input.value.trim() : '';
  }

  async askClarification(question, role, previousArgument) {
    this.isPaused = true; // Pause loop

    // Configure modal for IN-DEBATE clarification
    this.pendingClarification = { role, previousArgument };

    this.clarificationClaim.innerHTML = `<span style="color: #666; font-style: italic;">(The ${role} needs more info)</span>`;
    this.clarificationQuestion.textContent = question;
    this.clarificationAnswer.value = '';

    // Change button text temporarily
    const originalBtnText = this.submitClarificationBtn.textContent;
    this.submitClarificationBtn.textContent = 'Reply & Resume';

    this.clarificationModal.classList.remove('hidden');
    this.clarificationAnswer.focus();

    // Override submit handler slightly differently or rely on state?
    // We'll rely on submitClarification() checking for `this.pendingClarification`
  }

  submitClarification() {
    if (this.submitClarificationBtn) this.submitClarificationBtn.textContent = 'Continuing...';
    const answerInputs = this.clarificationQuestionsContainer.querySelectorAll('.batch-answer');
    const answers = [];
    let hasEmpty = false;

    answerInputs.forEach(input => {
      const val = input.value.trim();
      if (!val) {
        input.classList.add('error');
        hasEmpty = true;
      } else {
        input.classList.remove('error');
        const question = input.dataset.question;
        answers.push({ question, answer: val });

        // Add to main clarifications tracker
        this.clarifications.push({
          question,
          answer: val,
          timestamp: Date.now()
        });
      }
    });

    // Handle legacy single-textarea if it exists and had content
    if (this.clarificationAnswer && this.clarificationAnswer.value.trim() && answers.length === 0) {
      const val = this.clarificationAnswer.value.trim();
      const question = this.clarificationQuestion.textContent;
      answers.push({ question, answer: val });
      this.clarifications.push({ question, answer: val, timestamp: Date.now() });
    }

    if (hasEmpty && answerInputs.length > 0) return;

    this.clarificationModal.classList.add('hidden');

    // If this was pre-debate check (Analyzing Idea)
    if (this.isPreDebateClarification) {
      this.isPreDebateClarification = false;
      this.proceedWithDebate(this.preDebateIdea, this.preDebateFiles);
    }
    // If this was Discovery Phase (Round 1 preamble)
    else if (this.currentRound === 1 && !this.pendingTurnRetry) {
      console.log('🚀 Discovery Phase Answers received');
      this.isPaused = false;
      this.discoveryDone = true; // Mark discovery as complete

      // Store in clarifications array so server gets it
      this.clarifications = [...(this.clarifications || []), ...answers];
      this.factSheet = answers.map(a => `${a.question}: ${a.answer}`).join('\n');

      // Add Q&A bubbles to chat for context
      answers.forEach(item => {
        const sysMsg = document.createElement('div');
        sysMsg.className = 'message system-clarification';
        sysMsg.innerHTML = `
          <div class="message-content">
            <strong>Q:</strong> ${this.escapeHtml(item.question)}<br>
            <strong>A:</strong> ${this.escapeHtml(item.answer)}
          </div>
        `;
        this.debateChat.appendChild(sysMsg);
      });
      this.scrollToBottom(this.debateChat);

      // Discovery is done. Resume Round 1 but for Arguments.
      this.runDebateLoop();
    }
    // If this was in-debate fact-check (retry mode)
    else if (this.pendingTurnRetry) {
      const { role, previousArgument, messageEl } = this.pendingTurnRetry;
      this.pendingTurnRetry = null;
      this.isPaused = false;

      // Add Q&A bubbles to chat for context
      answers.forEach(item => {
        const sysMsg = document.createElement('div');
        sysMsg.className = 'message system-clarification';
        sysMsg.innerHTML = `
          <div class="message-content">
            <strong>Q:</strong> ${this.escapeHtml(item.question)}<br>
            <strong>A:</strong> ${this.escapeHtml(item.answer)}
          </div>
        `;
        // Insert after the draft message to preserve chronology
        if (messageEl) {
          this.debateChat.insertBefore(sysMsg, messageEl.nextSibling);
        } else {
          this.debateChat.appendChild(sysMsg);
        }
      });

      // We no longer remove the messageEl, as the user wants to see the flow (Thinking -> Q&A -> Argument)
      if (messageEl) {
        messageEl.style.opacity = '0.7'; // Fade it slightly to show it's a draft/interrupted
      }

      // Resume the loop - it will call runDebateRound,
      // which will see this.interruptedTurn and continue correctly
      this.runDebateLoop();
    }
  }

  togglePause() {
    this.isPaused = !this.isPaused;

    if (this.isPaused) {
      if (this.pauseDebateBtn) {
        this.pauseDebateBtn.textContent = '▶';
        this.pauseDebateBtn.title = 'Resume';
      }
    } else {
      if (this.pauseDebateBtn) {
        this.pauseDebateBtn.textContent = '⏸';
        this.pauseDebateBtn.title = 'Pause';
      }
      this.runDebateLoop();
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.authManager = new AuthManager();
  window.fileManager = new FileManager();
  window.debateArena = new DebateArena();
});
