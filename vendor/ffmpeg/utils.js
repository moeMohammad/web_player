
export const getMessageID = (() => {
    let messageID = 0;
    return () => messageID++;
})();
