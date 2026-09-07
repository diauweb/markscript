;(() => {
  document.documentElement.classList.add('js')

  const sidebar = document.querySelector('[data-sidebar]')
  const menu = document.querySelector('[data-menu]')
  const search = document.querySelector('[data-search]')
  const mobile = window.matchMedia('(max-width: 800px)')

  if (
    !(sidebar instanceof HTMLElement) ||
    !(menu instanceof HTMLButtonElement)
  ) {
    return
  }

  const setOpen = (open, restoreFocus = false) => {
    const mobileOpen = mobile.matches && open
    sidebar.dataset.open = String(mobileOpen)
    sidebar.toggleAttribute('inert', mobile.matches && !mobileOpen)
    sidebar.setAttribute('aria-hidden', String(mobile.matches && !mobileOpen))
    menu.setAttribute('aria-expanded', String(mobileOpen))
    if (mobileOpen && search instanceof HTMLInputElement) search.focus()
    if (!mobileOpen && restoreFocus) menu.focus()
  }

  const synchronizeViewport = () => setOpen(!mobile.matches)
  synchronizeViewport()
  mobile.addEventListener('change', synchronizeViewport)

  menu.addEventListener('click', () => {
    setOpen(sidebar.dataset.open !== 'true', true)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && sidebar.dataset.open === 'true') {
      setOpen(false, true)
    }
  })
  document.addEventListener('click', (event) => {
    if (!mobile.matches || sidebar.dataset.open !== 'true') return
    const target = event.target
    if (
      !(target instanceof Node) ||
      sidebar.contains(target) ||
      menu.contains(target)
    ) {
      return
    }
    setOpen(false)
  })
  sidebar.addEventListener('click', (event) => {
    if (mobile.matches && event.target instanceof HTMLAnchorElement) {
      setOpen(false)
    }
  })
  search?.addEventListener('input', () => {
    if (!(search instanceof HTMLInputElement)) return
    const query = search.value.trim().toLocaleLowerCase()
    document.querySelectorAll('[data-nav-item]').forEach((item) => {
      if (!(item instanceof HTMLElement)) return
      const label = item.textContent?.toLocaleLowerCase() ?? ''
      item.hidden = query !== '' && !label.includes(query)
    })
  })
})()
