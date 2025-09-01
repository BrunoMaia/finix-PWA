// Define um nome e versão para o cache. Mudar este nome invalida o cache antigo.
const CACHE_NAME = 'finance-pwa-cache-v1';

// Lista de arquivos essenciais para o funcionamento offline do app (o "App Shell").
const urlsToCache = [
    './', // Cacheia a página principal (index.html)
    './main.js', // Cacheia o arquivo JavaScript principal
    // Se você tivesse um arquivo CSS, ele seria listado aqui: './style.css'
];

/**
 * Evento 'install': Disparado quando o Service Worker é instalado pela primeira vez.
 * É aqui que colocamos os arquivos essenciais em cache.
 */
self.addEventListener('install', event => {
    // event.waitUntil espera a Promise terminar para garantir que a instalação foi bem-sucedida.
    event.waitUntil(
        caches.open(CACHE_NAME) // Abre o nosso cache pelo nome definido.
            .then(cache => {
                console.log('Cache aberto com sucesso.');
                // Adiciona todos os arquivos da nossa lista ao cache.
                return cache.addAll(urlsToCache);
            })
    );
});

/**
 * Evento 'fetch': Disparado toda vez que a página faz uma requisição de rede (ex: carregar uma imagem, script, ou a própria página).
 * Nós interceptamos essa requisição para decidir se servimos do cache ou da rede.
 */
self.addEventListener('fetch', event => {
    // event.respondWith intercepta a requisição e nos permite fornecer nossa própria resposta.
    event.respondWith(
        // Tenta encontrar uma resposta para esta requisição no nosso cache.
        caches.match(event.request)
            .then(response => {
                // Se uma resposta for encontrada no cache (response !== null), a retorna.
                if (response) {
                    return response;
                }
                // Se não for encontrada no cache, faz a requisição à rede como faria normalmente.
                return fetch(event.request);
            })
    );
});