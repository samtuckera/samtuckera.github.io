let n = 0;
setInterval(() => {
    n--;
    document.body.style.backgroundPosition = `${n}px 0px`;
}, 100);